import type { Buffer } from "node:buffer";

import process from "node:process";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import pino from "pino";

import TileFetcher from "./tile-fetcher.js";
import TileStorage, { createDefaultStorage, NullStorage } from "./storage.js";
import { warpTile } from "./warp.js";

// ==================== Configuration ====================
const MAP_SOURCE_URL = process.env.MAP_SOURCE || "http://wprd0{1-4}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=8";
const MAP_SOURCE_HEADERS = process.env.MAP_SOURCE_HEADERS ? JSON.parse(process.env.MAP_SOURCE_HEADERS) : {};
const CACHE_MAX_SIZE = Number.parseInt(process.env.CACHE_MAX_SIZE || "200");
const CACHE_RESET_INTERVAL = Number.parseInt(process.env.CACHE_RESET_INTERVAL || "60000");
const TILE_LOAD_TIMEOUT = Number.parseInt(process.env.TILE_LOAD_TIMEOUT || "30000");
const SERVER_PORT = Number.parseInt(process.env.PORT || "5000");

// ==================== Logger ====================
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    },
  },
});

logger.info(`Map source URL: ${MAP_SOURCE_URL}`);

// ==================== Tile Fetcher ====================
const tileFetcher = new TileFetcher({
  urlTemplate: MAP_SOURCE_URL,
  timeout: TILE_LOAD_TIMEOUT,
  headers: MAP_SOURCE_HEADERS,
});

// ==================== Storage Configuration ====================
const s3Storage = createDefaultStorage() || new NullStorage();
const s3Enabled = s3Storage instanceof TileStorage;

// ==================== LRU Cache Implementation ====================
class LRUCache {
  private cache: Map<string, Buffer>;

  constructor(private maxSize: number = 100) {
    this.cache = new Map();
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

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      usage: `${Math.round((this.cache.size / this.maxSize) * 100)}%`,
    };
  }
}

const tileCache = new LRUCache(CACHE_MAX_SIZE);

// eslint-disable-next-line unused-imports/no-unused-vars
const cacheResetInterval = setInterval(() => {
  tileCache.clear();
  logger.info("Tile cache cleared");
  logger.info({ cacheStats: tileCache.getStats() }, "Cache stats after reset");
}, CACHE_RESET_INTERVAL);

export function resetCache(): void {
  logger.info("Manually resetting cache");
  tileCache.clear();
  logger.info({ cacheStats: tileCache.getStats() }, "Cache stats after reset");
}

// ==================== Tile Fetch Function ====================
async function getTile(x: number, y: number, z: number): Promise<Buffer> {
  logger.info(`getTile: ${x}, ${y}, ${z}`);

  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") {
    const error = new Error("Invalid tile coordinates: x, y, and z must be numbers");
    logger.error({ x, y, z, error: error.message }, "Tile parameter validation error");
    throw error;
  }

  const cacheKey = `${x}-${y}-${z}`;

  // 1. Check memory cache
  const lruCachedTile = tileCache.get(cacheKey);
  if (lruCachedTile) {
    logger.info(`tile loaded from LRU cache: ${cacheKey}`);
    return lruCachedTile;
  }

  // 2. Check S3 cache (if enabled)
  if (s3Enabled) {
    try {
      const s3CachedTile = await s3Storage.getTile(z, x, y);
      if (s3CachedTile) {
        logger.info(`tile loaded from S3 cache: ${cacheKey}`);
        tileCache.set(cacheKey, s3CachedTile);
        return s3CachedTile;
      }
    }
    catch (error) {
      logger.warn({ x, y, z, error: (error as Error).message }, "Failed to load from S3 cache");
    }
  }

  // 3. Warp tile from source
  try {
    const buffer = await warpTile(x, y, z, tileFetcher);

    // 4. Save to memory cache
    tileCache.set(cacheKey, buffer);

    // 5. Asynchronously save to S3 cache (if enabled)
    if (s3Enabled) {
      s3Storage.saveTile(z, x, y, buffer, "png").catch((error) => {
        logger.warn({ x, y, z, error: (error as Error).message }, "Failed to save to S3 cache");
      });
    }

    if (tileCache.size() % 100 === 0) {
      logger.info({ cacheStats: tileCache.getStats() }, "Cache stats");
    }

    return buffer;
  }
  catch (error) {
    logger.error({ x, y, z, error: (error as Error).message }, "Error in getTile");
    throw error;
  }
}

// ==================== Parameter Validation ====================
function validateTileParams(x: string | undefined, y: string | undefined, z: string | undefined) {
  if (x === undefined || y === undefined || z === undefined) {
    return { valid: false, error: "Missing required parameters: x, y, and z are required" };
  }

  const xNum = Number.parseInt(x, 10);
  const yNum = Number.parseInt(y, 10);
  const zNum = Number.parseInt(z, 10);

  if (Number.isNaN(xNum) || Number.isNaN(yNum) || Number.isNaN(zNum)) {
    return { valid: false, error: "Invalid parameters: x, y, and z must be valid integers" };
  }

  return { valid: true, x: xNum, y: yNum, z: zNum };
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
  catch (err) {
    const ms = Date.now() - start;
    logger.error(`${req.method} ${req.url} - ${ms}ms - Error: ${(err as Error).message}`);
    throw err;
  }
});

app.get("/appmaptile", async (c) => {
  try {
    const x = c.req.query("x");
    const y = c.req.query("y");
    const z = c.req.query("z");

    const validation = validateTileParams(x, y, z);

    if (!validation.valid) {
      logger.warn(
        { x, y, z, error: validation.error },
        "Tile parameter validation failed",
      );
      return c.json({ error: validation.error }, 400);
    }

    const { x: xNum, y: yNum, z: zNum } = validation;
    const buf = await getTile(xNum, yNum, zNum) as any;

    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
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
    status: "ok",
    timestamp: new Date().toISOString(),
    cacheStats: tileCache.getStats(),
  });
});

app.get("/cache-stats", (c) => {
  return c.json({
    lruCache: tileCache.getStats(),
    s3Enabled,
    ...(s3Enabled
      ? {
          s3Bucket: process.env.S3_BUCKET || "map-tiles",
          s3Prefix: process.env.S3_PREFIX || "tiles",
          s3Region: process.env.AWS_REGION || "us-east-1",
        }
      : {}),
  });
});

app.post("/reset-cache", (c) => {
  try {
    resetCache();
    return c.json({
      status: "success",
      message: "Cache reset successfully",
      cacheStats: tileCache.getStats(),
    });
  }
  catch (error) {
    logger.error({ error }, "Error resetting cache");
    return c.json({ error: "Failed to reset cache" }, 500);
  }
});

app.post("/s3-cache/clear", async (c) => {
  if (!s3Enabled) {
    return c.json({ error: "S3 storage is not enabled" }, 400);
  }

  try {
    const { z, x, y } = c.req.query();

    if (z && x && y) {
      const zNum = Number.parseInt(z);
      const xNum = Number.parseInt(x);
      const yNum = Number.parseInt(y);

      await s3Storage.deleteTile(zNum, xNum, yNum);
      logger.info(`S3 cache cleared for tile: ${x}-${y}-${z}`);

      return c.json({
        status: "success",
        message: `S3 cache cleared for tile ${x}-${y}-${z}`,
      });
    }
    else {
      logger.warn("S3 cache clear all not implemented - requires batch delete");
      return c.json({
        status: "warning",
        message: "S3 cache clear all not implemented - requires batch delete",
      });
    }
  }
  catch (error) {
    logger.error({ error }, "Error clearing S3 cache");
    return c.json({ error: "Failed to clear S3 cache" }, 500);
  }
});

app.get("/s3-cache/check", async (c) => {
  if (!s3Enabled) {
    return c.json({ error: "S3 storage is not enabled" }, 400);
  }

  try {
    const { z, x, y } = c.req.query();

    if (!z || !x || !y) {
      return c.json({ error: "Missing parameters: z, x, y are required" }, 400);
    }

    const zNum = Number.parseInt(z);
    const xNum = Number.parseInt(x);
    const yNum = Number.parseInt(y);

    const exists = await s3Storage.hasTile(zNum, xNum, yNum);

    return c.json({
      exists,
      tile: `${x}-${y}-${z}`,
      url: s3Storage.getTileUrl(zNum, xNum, yNum),
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
