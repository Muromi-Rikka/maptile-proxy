import type { Buffer } from "node:buffer";

import { serve } from "@hono/node-server";
import canvas from "canvas";
import { Hono } from "hono";
import process from "node:process";
import { Document } from "nodom";
import EventType from "ol/events/EventType.js";
import { getTopLeft, getWidth } from "ol/extent.js";
import * as olLayer from "ol/layer.js";
import * as olProj from "ol/proj.js";
import * as olSource from "ol/source.js";
import WMTSTileGrid from "ol/tilegrid/WMTS.js";
import TileState from "ol/TileState.js";
import pino from "pino";
import gcj02Mercator from "./gcj02";
import TileStorage, { createDefaultStorage, NullStorage } from "./storage";

// ==================== Configuration ====================
const MAP_SOURCE_URL = process.env.MAP_SOURCE || "https://api.maptiler.com/maps/satellite/{z}/{x}/{y}.jpg?key=YOUR_MAPTILER_KEY";
const CACHE_MAX_SIZE = Number.parseInt(process.env.CACHE_MAX_SIZE || "200");
const CACHE_RESET_INTERVAL = Number.parseInt(process.env.CACHE_RESET_INTERVAL || "60000");
const TILE_LOAD_TIMEOUT = Number.parseInt(process.env.TILE_LOAD_TIMEOUT || "30000");
const SERVER_PORT = Number.parseInt(process.env.PORT || "5000");

// ==================== Global Initialization ====================
const Image = canvas.Image;
const globalAny = globalThis as any;

globalAny.Image = Image;
globalAny.Canvas = canvas.Canvas;
globalAny.OffscreenCanvas = canvas.Canvas;
globalAny.WorkerGlobalScope = Object;
globalAny.self = {};

globalAny.document = new Document();
globalAny.document.createElement_ori = globalAny.document.createElement;
globalAny.document.createElement = (name: string) => {
  if (name === "canvas") {
    return new globalAny.Canvas(512, 512);
  }
  return globalAny.document.createElement_ori(name);
};

// Add event listener methods
if (Image && Image.prototype) {
  // eslint-disable-next-line ts/ban-ts-comment
  // @ts-expect-error
  Image.prototype.addEventListener = function (type: string, handler: Function) {
    (this as any)[`on${type}`] = handler.bind(this);
  };

  // eslint-disable-next-line ts/ban-ts-comment
  // @ts-expect-error
  Image.prototype.removeEventListener = function (type: string) {
    (this as any)[`on${type}`] = null;
  };
}

// ==================== Map Configuration ====================
const ol = { layer: olLayer, proj: olProj, source: olSource };
const projectionExtent = gcj02Mercator.getExtent();
const size = getWidth(projectionExtent) / 256;

const matrixIds = Array.from({ length: 19 }, (_, index) => index.toString());
const resolutions = Array.from({ length: 19 }, (_, z) => size / 2 ** z);

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    options: {
      colorize: true,
      ignore: "pid,hostname",
      translateTime: "SYS:standard",
    },
    target: "pino-pretty",
  },
});

logger.info(`Map source URL: ${MAP_SOURCE_URL}`);

// ==================== Storage Configuration ====================
const s3Storage = createDefaultStorage() || new NullStorage();
const isS3Enabled = s3Storage instanceof TileStorage;

// ==================== LRU Cache Implementation ====================
class LRUCache {
  private cache: Map<string, Buffer>;

  constructor(private maxSize: number = 100) {
    this.cache = new Map();
  }

  clear(): void {
    this.cache.clear();
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  get(key: string): Buffer | null {
    const item = this.cache.get(key);
    if (item) {
      this.cache.delete(key);
      this.cache.set(key, item);
      return item;
    }
    return null;
  }

  getStats() {
    return {
      maxSize: this.maxSize,
      size: this.cache.size,
      usage: `${Math.round((this.cache.size / this.maxSize) * 100)}%`,
    };
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  set(key: string, value: Buffer): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  size(): number {
    return this.cache.size;
  }
}

// ==================== Map Render Layer ====================
function createRenderLayer() {
  const tileLayer = new ol.layer.Tile({
    opacity: 1,
    source: new ol.source.XYZ({
      projection: gcj02Mercator,
      tileGrid: new WMTSTileGrid({
        matrixIds,
        origin: getTopLeft(gcj02Mercator.getExtent()),
        resolutions,
      }),
      url: MAP_SOURCE_URL,
      wrapX: true,
    }),
  });

  return tileLayer.createRenderer();
}

let renderLayer = createRenderLayer();
const tileCache = new LRUCache(CACHE_MAX_SIZE);

const _cacheResetInterval = setInterval(() => {
  renderLayer = createRenderLayer();
  tileCache.clear();
  logger.info({ cacheStats: tileCache.getStats() }, "Tile cache cleared and render layer reset");
}, CACHE_RESET_INTERVAL);

export function resetRenderLayer(): void {
  logger.info("Manually resetting render layer and cache");
  renderLayer = createRenderLayer();
  tileCache.clear();
  logger.info({ cacheStats: tileCache.getStats() }, "Tile cache cleared and render layer reset");
}

// ==================== Tile Fetch Function ====================
async function getTile(x: number, y: number, z: number): Promise<Buffer> {
  logger.debug(`getTile: ${x}, ${y}, ${z}`);

  const cacheKey = `${x}-${y}-${z}`;

  // 1. First check memory cache
  const lruCachedTile = tileCache.get(cacheKey);
  if (lruCachedTile) {
    logger.debug(`tile loaded from LRU cache: ${cacheKey}`);
    return lruCachedTile;
  }

  // 2. Then check S3 cache (if enabled)
  if (isS3Enabled) {
    try {
      const s3CachedTile = await s3Storage.getTile(z, x, y);
      if (s3CachedTile) {
        logger.debug(`tile loaded from S3 cache: ${cacheKey}`);
        // Also save to memory cache
        tileCache.set(cacheKey, s3CachedTile);
        return s3CachedTile;
      }
    }
    catch (error) {
      logger.warn({ error: (error as Error).message, x, y, z }, "Failed to load from S3 cache");
    }
  }

  // 3. If no cache exists, fetch from source
  try {
    const tile = (renderLayer as any).getTile(z, x, y, {
      pixelRatio: 2,
      viewState: {
        projection: olProj.get("EPSG:3857"),
      },
    });

    if (!tile) {
      throw new Error("Tile is null or undefined");
    }

    if (
      tile.getState() !== TileState.LOADED
      && tile.getState() !== TileState.EMPTY
    ) {
      logger.debug("tile not loaded, reloading...");
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          tile.removeEventListener(EventType.CHANGE, handler);
          const error = new Error(`Tile loading timeout after ${TILE_LOAD_TIMEOUT}ms`);
          logger.error({ error: error.message, x, y, z }, "Tile loading timeout");
          reject(error);
        }, TILE_LOAD_TIMEOUT);

        const handler = () => {
          const s = tile.getState();
          switch (s) {
            case TileState.EMPTY:
            case TileState.LOADED: {
              clearTimeout(timeout);
              tile.removeEventListener(EventType.CHANGE, handler);
              resolve();
              break;
            }
            case TileState.ERROR: {
              clearTimeout(timeout);
              tile.removeEventListener(EventType.CHANGE, handler);
              const error = new Error("Tile loading error");
              logger.error({ state: s, x, y, z }, "Tile loading error");
              reject(error);
              break;
            }
            case TileState.IDLE:
            case TileState.LOADING: {
              break;
            }
          }
        };

        tile.addEventListener(EventType.CHANGE, handler);
        tile.load();
      });
    }

    logger.debug(`tile load finished, status: ${tile.getState()}`);

    if (tile.getState() === TileState.ERROR) {
      const error = new Error("Tile failed to load");
      logger.error({ state: tile.getState(), x, y, z }, "Tile load failed");
      throw error;
    }

    const tileImage = (tile as any).getImage();
    if (!tileImage || typeof tileImage.toBuffer !== "function") {
      throw new Error("Invalid tile image data");
    }

    const buffer = tileImage.toBuffer() as Buffer;

    // 4. Save to memory cache
    tileCache.set(cacheKey, buffer);

    // 5. Asynchronously save to S3 cache (if enabled)
    if (isS3Enabled) {
      s3Storage.saveTile(z, x, y, buffer, "png").catch((error) => {
        logger.warn({ error: (error as Error).message, x, y, z }, "Failed to save to S3 cache");
      });
    }

    if (tileCache.size() % 100 === 0) {
      logger.debug({ cacheStats: tileCache.getStats() }, "Cache stats");
    }

    return buffer;
  }
  catch (error) {
    logger.error({ error: (error as Error).message, x, y, z }, "Error in getTile");
    throw error;
  }
}

// ==================== Parameter Validation ====================
function validateTileParameters(x: string | undefined, y: string | undefined, z: string | undefined) {
  if (x === undefined || y === undefined || z === undefined) {
    return { error: "Missing required parameters: x, y, and z are required", valid: false };
  }

  const xNumber = Number(x);
  const yNumber = Number(y);
  const zNumber = Number(z);

  if (Number.isNaN(xNumber) || Number.isNaN(yNumber) || Number.isNaN(zNumber)) {
    return { error: "Invalid parameters: x, y, and z must be valid integers", valid: false };
  }

  return { valid: true, x: xNumber, y: yNumber, z: zNumber };
}

// ==================== Hono Application ====================
const app = new Hono();

app.use("*", async (c, next) => {
  const start = Date.now();
  const { req } = c;

  try {
    await next();
    const ms = Date.now() - start;
    logger.info(`${req.method} ${req.url} - ${ms}ms`);
  }
  catch (error) {
    const ms = Date.now() - start;
    logger.error(`${req.method} ${req.url} - ${ms}ms - Error: ${(error as Error).message}`);
    throw error;
  }
});

app.get("/appmaptile", async (c) => {
  try {
    const x = c.req.query("x");
    const y = c.req.query("y");
    const z = c.req.query("z");

    const validation = validateTileParameters(x, y, z);

    if (!validation.valid) {
      logger.warn(
        { error: validation.error, x, y, z },
        "Tile parameter validation failed",
      );
      return c.json({ error: validation.error }, 400);
    }

    const { x: xNumber, y: yNumber, z: zNumber } = validation;
    const buffer = await getTile(xNumber, yNumber, zNumber);

    return new Response(buffer, {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Type": "image/png",
      },
      status: 200,
    });
  }
  catch (error) {
    logger.error({
      error: (error as Error).message,
      stack: (error as Error).stack,
      url: c.req.url,
    }, "Error serving tile");
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/health", (c) => {
  return c.json({
    cacheStats: tileCache.getStats(),
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/cache-stats", (c) => {
  return c.json({
    lruCache: tileCache.getStats(),
    s3Enabled: isS3Enabled,
    ...(isS3Enabled && {
      s3Bucket: process.env.S3_BUCKET || "map-tiles",
      s3Prefix: process.env.S3_PREFIX || "tiles",
      s3Region: process.env.AWS_REGION || "us-east-1",
    }),
  });
});

app.post("/reset-cache", (c) => {
  try {
    resetRenderLayer();
    return c.json({
      cacheStats: tileCache.getStats(),
      message: "Cache reset successfully",
      status: "success",
    });
  }
  catch (error) {
    logger.error({ error }, "Error resetting cache");
    return c.json({ error: "Failed to reset cache" }, 500);
  }
});

app.post("/s3-cache/clear", async (c) => {
  if (!isS3Enabled) {
    return c.json({ error: "S3 storage is not enabled" }, 400);
  }

  try {
    const x = c.req.query("x");
    const y = c.req.query("y");
    const z = c.req.query("z");

    if (x && y && z) {
      const validation = validateTileParameters(x, y, z);
      if (!validation.valid) {
        return c.json({ error: validation.error }, 400);
      }

      const { x: xNumber, y: yNumber, z: zNumber } = validation;
      await s3Storage.deleteTile(zNumber, xNumber, yNumber);
      logger.info(`S3 cache cleared for tile: ${x}-${y}-${z}`);

      return c.json({
        message: `S3 cache cleared for tile ${x}-${y}-${z}`,
        status: "success",
      });
    }
    logger.warn("S3 cache clear all not implemented - requires batch delete");
    return c.json({
      message: "S3 cache clear all not implemented - requires batch delete",
      status: "warning",
    });
  }
  catch (error) {
    logger.error({ error }, "Error clearing S3 cache");
    return c.json({ error: "Failed to clear S3 cache" }, 500);
  }
});

app.get("/s3-cache/check", async (c) => {
  if (!isS3Enabled) {
    return c.json({ error: "S3 storage is not enabled" }, 400);
  }

  try {
    const x = c.req.query("x");
    const y = c.req.query("y");
    const z = c.req.query("z");

    const validation = validateTileParameters(x, y, z);
    if (!validation.valid) {
      return c.json({ error: validation.error }, 400);
    }

    const { x: xNumber, y: yNumber, z: zNumber } = validation;
    const exists = await s3Storage.hasTile(zNumber, xNumber, yNumber);

    return c.json({
      exists,
      tile: `${x}-${y}-${z}`,
      url: s3Storage.getTileUrl(zNumber, xNumber, yNumber),
    });
  }
  catch (error) {
    logger.error({ error }, "Error checking S3 cache");
    return c.json({ error: "Failed to check S3 cache" }, 500);
  }
});

serve(
  {
    fetch: app.fetch,
    port: SERVER_PORT,
  },
  (info) => {
    logger.info(`Server is running on port ${info.port}`);
  },
);
