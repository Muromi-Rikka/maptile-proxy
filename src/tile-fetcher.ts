import { Buffer } from "node:buffer";

/**
 * Tile fetcher — replaces OpenLayers for tile URL resolution and HTTP fetching.
 *
 * Supports URL templates with placeholders:
 *   {x}, {y}, {z}  — tile coordinates
 *   {1-4}           — random integer in range (common in tile server load balancing)
 */

// ==================== URL Template ====================

/**
 * Expand URL template by replacing placeholders.
 *
 * @example
 * expandTemplate("http://wprd0{1-4}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}", 123, 456, 8)
 * // => "http://wprd02.is.autonavi.com/appmaptile?x=123&y=456&z=8"
 */
export function expandTemplate(template: string, x: number, y: number, z: number): string {
  return template
    .replace(/\{(\d+)-(\d+)\}/g, (_match, min: string, max: string) => {
      const lo = Number.parseInt(min, 10);
      const hi = Number.parseInt(max, 10);
      return String(lo + Math.floor(Math.random() * (hi - lo + 1)));
    })
    .replace("{x}", String(x))
    .replace("{y}", String(y))
    .replace("{z}", String(z));
}

// ==================== Tile Fetcher ====================

export interface TileFetcherOptions {
  /** URL template with {x}, {y}, {z} placeholders */
  urlTemplate: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Custom headers for tile requests */
  headers?: Record<string, string>;
}

/**
 * Fetches raster tiles from a URL-template-based tile source.
 */
export class TileFetcher {
  private urlTemplate: string;
  private timeout: number;
  private headers: Record<string, string>;

  constructor(options: TileFetcherOptions) {
    this.urlTemplate = options.urlTemplate;
    this.timeout = options.timeout ?? 30_000;
    this.headers = options.headers ?? {};
  }

  /**
   * Fetch a single tile as a PNG Buffer.
   */
  async fetch(x: number, y: number, z: number): Promise<Buffer> {
    const url = expandTemplate(this.urlTemplate, x, y, z);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(url, {
        headers: this.headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Tile fetch failed: ${res.status} ${res.statusText} — ${url}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetch multiple tiles concurrently.
   * Returns a Map keyed by "x-y-z".
   */
  async fetchMany(
    tiles: Array<{ x: number; y: number; z: number }>,
  ): Promise<Map<string, Buffer>> {
    const results = await Promise.allSettled(
      tiles.map(t => this.fetch(t.x, t.y, t.z)),
    );

    const map = new Map<string, Buffer>();
    for (let i = 0; i < tiles.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") {
        map.set(`${tiles[i].x}-${tiles[i].y}-${tiles[i].z}`, result.value);
      }
    }
    return map;
  }

  /**
   * Get the URL that would be requested for a given tile.
   */
  getUrl(x: number, y: number, z: number): string {
    return expandTemplate(this.urlTemplate, x, y, z);
  }
}

export default TileFetcher;
