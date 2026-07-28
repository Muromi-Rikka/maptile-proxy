import { Buffer } from "node:buffer";
import sharp from "sharp";
import { delta } from "./gcj02.js";
import type TileFetcher from "./tile-fetcher.js";

/**
 * GCJ-02 warping engine — replaces OpenLayers + canvas for pixel-level
 * coordinate displacement with bilinear interpolation.
 *
 * Given a standard EPSG:3857 tile request (x, y, z), this module:
 *  1. Computes which source tiles in GCJ-02 space are needed
 *  2. Fetches them via TileFetcher
 *  3. For each output pixel, applies GCJ-02 offset and samples
 *     the source with bilinear interpolation
 *  4. Returns the warped PNG tile
 */

const TILE_SIZE = 256;
const EARTH_HALF = 20037508.342789244;

// ==================== Coordinate helpers ====================

function tileWidthMeters(z: number): number {
  return (2 * EARTH_HALF) / (1 << z);
}

function tileBounds3857(x: number, y: number, z: number) {
  const w = tileWidthMeters(z);
  const minX = -EARTH_HALF + x * w;
  const maxY = EARTH_HALF - y * w;
  return { minX, maxX: minX + w, minY: maxY - w, maxY };
}

function mercatorToLngLat(mx: number, my: number): [number, number] {
  const RADIUS = 6378137;
  const RAD2DEG = 180 / Math.PI;
  return [mx / RADIUS * RAD2DEG, (2 * Math.atan(Math.exp(my / RADIUS)) - Math.PI / 2) * RAD2DEG];
}

function lngLatToMercator(lng: number, lat: number): [number, number] {
  const RADIUS = 6378137;
  const DEG2RAD = Math.PI / 180;
  const sinLat = Math.sin(lat * DEG2RAD);
  return [RADIUS * lng * DEG2RAD, RADIUS * Math.log((1 + sinLat) / (1 - sinLat)) / 2];
}

/** Tile grid coordinates to EPSG:3857 meters (center of pixel). */
function pixelToMercator(px: number, py: number, bounds: ReturnType<typeof tileBounds3857>) {
  const step = (bounds.maxX - bounds.minX) / TILE_SIZE;
  return {
    mx: bounds.minX + (px + 0.5) * step,
    my: bounds.maxY - (py + 0.5) * step,
  };
}

/** EPSG:3857 meters to tile grid coordinates. */
function mercatorToPixel(mx: number, my: number, bounds: ReturnType<typeof tileBounds3857>) {
  const step = (bounds.maxX - bounds.minX) / TILE_SIZE;
  return {
    px: (mx - bounds.minX) / step - 0.5,
    py: (bounds.maxY - my) / step - 0.5,
  };
}

// ==================== Bilinear interpolation ====================

function sampleBilinear(
  pixels: Uint8Array,
  width: number,
  height: number,
  fx: number,
  fy: number,
): [number, number, number, number] {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const dx = fx - x0;
  const dy = fy - y0;

  // All four corners out of bounds → transparent
  if ((x0 < 0 || x0 >= width || y0 < 0 || y0 >= height)
    && (x1 < 0 || x1 >= width || y0 < 0 || y0 >= height)
    && (x0 < 0 || x0 >= width || y1 < 0 || y1 >= height)
    && (x1 < 0 || x1 >= width || y1 < 0 || y1 >= height)) {
    return [0, 0, 0, 0];
  }

  const getPixel = (ix: number, iy: number): [number, number, number, number] => {
    if (ix < 0 || ix >= width || iy < 0 || iy >= height) return [0, 0, 0, 0];
    const offset = (iy * width + ix) * 4;
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]];
  };

  const [r00, g00, b00, a00] = getPixel(x0, y0);
  const [r10, g10, b10, a10] = getPixel(x1, y0);
  const [r01, g01, b01, a01] = getPixel(x0, y1);
  const [r11, g11, b11, a11] = getPixel(x1, y1);

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  return [
    Math.round(lerp(lerp(r00, r10, dx), lerp(r01, r11, dx), dy)),
    Math.round(lerp(lerp(g00, g10, dx), lerp(g01, g11, dx), dy)),
    Math.round(lerp(lerp(b00, b10, dx), lerp(b01, b11, dx), dy)),
    Math.round(lerp(lerp(a00, a10, dx), lerp(a01, a11, dx), dy)),
  ];
}

// ==================== Tile sampling ====================

function sampleFromTiles(
  sourcePixels: Map<string, Uint8Array>,
  gcjTileX: number,
  gcjTileY: number,
  fx: number,
  fy: number,
  tileKey: (tx: number, ty: number) => string,
): [number, number, number, number] {
  const tx = Math.floor(gcjTileX);
  const ty = Math.floor(gcjTileY);

  const offsets: Array<{ dx: number; dy: number; weight: number }> = [];
  const fxLocal = gcjTileX - tx;
  const fyLocal = gcjTileY - ty;

  if (fxLocal < 0.5) {
    offsets.push({ dx: -1, dy: -1, weight: (0.5 - fxLocal) * (0.5 - fyLocal) });
    offsets.push({ dx: 0, dy: -1, weight: (0.5 + fxLocal) * (0.5 - fyLocal) });
    offsets.push({ dx: -1, dy: 0, weight: (0.5 - fxLocal) * (0.5 + fyLocal) });
    offsets.push({ dx: 0, dy: 0, weight: (0.5 + fxLocal) * (0.5 + fyLocal) });
  } else {
    offsets.push({ dx: 0, dy: 0, weight: (1.5 - fxLocal) * (1.5 - fyLocal) });
    offsets.push({ dx: 1, dy: 0, weight: (fxLocal - 0.5) * (1.5 - fyLocal) });
    offsets.push({ dx: 0, dy: 1, weight: (1.5 - fxLocal) * (fyLocal - 0.5) });
    offsets.push({ dx: 1, dy: 1, weight: (fxLocal - 0.5) * (fyLocal - 0.5) });
  }

  let rSum = 0, gSum = 0, bSum = 0, aSum = 0, wSum = 0;

  for (const { dx, dy, weight } of offsets) {
    if (weight < 0.001) continue;
    const key = tileKey(tx + dx, ty + dy);
    const pixels = sourcePixels.get(key);
    if (!pixels) continue;

    const localX = (gcjTileX - (tx + dx)) * TILE_SIZE - 0.5;
    const localY = (gcjTileY - (ty + dy)) * TILE_SIZE - 0.5;

    const [r, g, b, a] = sampleBilinear(pixels, TILE_SIZE, TILE_SIZE, localX, localY);
    rSum += r * weight;
    gSum += g * weight;
    bSum += b * weight;
    aSum += a * weight;
    wSum += weight;
  }

  if (wSum < 0.001) return [0, 0, 0, 0];
  return [
    Math.round(rSum / wSum),
    Math.round(gSum / wSum),
    Math.round(bSum / wSum),
    Math.round(aSum / wSum),
  ];
}

// ==================== Public API ====================

/**
 * Given an output tile (x, y, z) in standard EPSG:3857 tile scheme,
 * produce a warped PNG where pixels are correctly displaced for a GCJ-02 tile source.
 */
export async function warpTile(
  x: number,
  y: number,
  z: number,
  fetcher: TileFetcher,
): Promise<Buffer> {
  const outBounds = tileBounds3857(x, y, z);
  const srcBounds = tileBounds3857(x, y, z);
  const maxTile = 1 << z;

  // --- Determine which GCJ-02 source tiles to fetch ---
  const corners = [
    pixelToMercator(0, 0, outBounds),
    pixelToMercator(TILE_SIZE - 1, 0, outBounds),
    pixelToMercator(0, TILE_SIZE - 1, outBounds),
    pixelToMercator(TILE_SIZE - 1, TILE_SIZE - 1, outBounds),
  ];

  const gcjCornerTiles: Array<{ tx: number; ty: number }> = [];
  for (const { mx, my } of corners) {
    const [lng, lat] = mercatorToLngLat(mx, my);
    const [dlon, dlat] = delta(lng, lat);
    const [smx, smy] = lngLatToMercator(lng + dlon, lat + dlat);
    const { px, py } = mercatorToPixel(smx, smy, srcBounds);
    gcjCornerTiles.push({ tx: Math.floor(px / TILE_SIZE), ty: Math.floor(py / TILE_SIZE) });
  }

  const minSrcX = Math.min(...gcjCornerTiles.map(t => t.tx));
  const maxSrcX = Math.max(...gcjCornerTiles.map(t => t.tx));
  const minSrcY = Math.min(...gcjCornerTiles.map(t => t.ty));
  const maxSrcY = Math.max(...gcjCornerTiles.map(t => t.ty));

  const srcTilesToFetch: Array<{ x: number; y: number; z: number }> = [];
  for (let sy = minSrcY; sy <= maxSrcY; sy++) {
    for (let sx = minSrcX; sx <= maxSrcX; sx++) {
      if (sy < 0 || sy >= maxTile) continue;
      const wrappedX = ((sx % maxTile) + maxTile) % maxTile;
      srcTilesToFetch.push({ x: wrappedX, y: sy, z });
    }
  }

  // --- Fetch source tiles ---
  const srcTileBuffers = await fetcher.fetchMany(srcTilesToFetch);

  // Decode to raw RGBA pixels
  const sourcePixels = new Map<string, Uint8Array>();
  const decodePromises = Array.from(srcTileBuffers.entries()).map(
    async ([key, buf]) => {
      const { data, info } = await sharp(buf)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      sourcePixels.set(key, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      void info;
    },
  );
  await Promise.all(decodePromises);

  // --- Warp ---
  const tileKey = (tx: number, ty: number) =>
    `${((tx % maxTile) + maxTile) % maxTile}-${ty}-${z}`;

  const outputPixels = new Uint8Array(TILE_SIZE * TILE_SIZE * 4);

  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      const { mx, my } = pixelToMercator(px, py, outBounds);
      const [lng, lat] = mercatorToLngLat(mx, my);
      const [dlon, dlat] = delta(lng, lat);
      const [gmx, gmy] = lngLatToMercator(lng + dlon, lat + dlat);
      const { px: srcPx, py: srcPy } = mercatorToPixel(gmx, gmy, srcBounds);
      const gcjTileX = srcPx / TILE_SIZE;
      const gcjTileY = srcPy / TILE_SIZE;

      const [r, g, b, a] = sampleFromTiles(sourcePixels, gcjTileX, gcjTileY, srcPx, srcPy, tileKey);
      const offset = (py * TILE_SIZE + px) * 4;
      outputPixels[offset] = r;
      outputPixels[offset + 1] = g;
      outputPixels[offset + 2] = b;
      outputPixels[offset + 3] = a;
    }
  }

  return sharp(Buffer.from(outputPixels.buffer), {
    raw: { width: TILE_SIZE, height: TILE_SIZE, channels: 4 },
  }).png().toBuffer();
}

export default warpTile;
