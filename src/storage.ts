import type { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Buffer } from "node:buffer";
import process from "node:process";

export interface S3StorageConfig {
  accessKeyId?: string;
  bucket: string;
  endpoint?: string;
  prefix?: string;
  region: string;
  secretAccessKey?: string;
}

// Null storage implementation for when S3 is disabled
export class NullStorage {
  async deleteTile(_z: number, _x: number, _y: number, _format?: string): Promise<void> {
    // No-op when S3 is disabled
  }

  getCloudFrontUrl(_domain: string, _z: number, _x: number, _y: number, _format?: string): string {
    return "";
  }

  async getTile(_z: number, _x: number, _y: number, _format?: string): Promise<Buffer | null> {
    return null;
  }

  getTileUrl(_z: number, _x: number, _y: number, _format?: string): string {
    return "";
  }

  async hasTile(_z: number, _x: number, _y: number, _format?: string): Promise<boolean> {
    return false;
  }

  async saveTile(_z: number, _x: number, _y: number, _tileData: Buffer, _format?: string, _contentType?: string): Promise<void> {
    // No-op when S3 is disabled
  }
}

export class TileStorage {
  private bucket: string;
  private client: S3Client;
  private prefix: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.prefix = config.prefix || "tiles";

    const s3Config: any = {
      region: config.region,
    };

    if (config.endpoint) {
      s3Config.endpoint = config.endpoint;
      s3Config.forcePathStyle = true;
    }

    if (config.accessKeyId && config.secretAccessKey) {
      s3Config.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    this.client = new S3Client(s3Config);
  }

  /**
   * Clear cache for specific zoom level
   */
  async clearZoomLevel(_z: number): Promise<void> {
    // This would require listing and deleting all objects with prefix
    // Implementation depends on specific S3 provider capabilities
    console.warn("clearZoomLevel not implemented - requires S3 list operation");
  }

  /**
   * Delete tile from S3 cache
   */
  async deleteTile(z: number, x: number, y: number, format: string = "png"): Promise<void> {
    const key = this.getTileKey(z, x, y, format);

    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }

  /**
   * Get CloudFront URL (if using CloudFront)
   */
  getCloudFrontUrl(domain: string, z: number, x: number, y: number, format: string = "png"): string {
    const key = this.getTileKey(z, x, y, format);
    return `https://${domain}/${key}`;
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{ totalSize: number; totalTiles: number }> {
    // This would require listing all objects in the bucket
    // Implementation depends on specific S3 provider capabilities
    console.warn("getStats not implemented - requires S3 list operation");
    return { totalSize: 0, totalTiles: 0 };
  }

  /**
   * Get tile from S3 cache
   */
  async getTile(z: number, x: number, y: number, format: string = "png"): Promise<Buffer | null> {
    try {
      const key = this.getTileKey(z, x, y, format);
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));

      if (!response.Body) {
        return null;
      }

      // Convert stream to buffer
      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        stream.on("data", (chunk) => {
          chunks.push(Buffer.from(chunk));
        });
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks)));
      });
    }
    catch (error: any) {
      if (error.name === "NoSuchKey" || error.name === "NotFound") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get tile URL (for direct access)
   */
  getTileUrl(z: number, x: number, y: number, format: string = "png"): string {
    const key = this.getTileKey(z, x, y, format);
    return `s3://${this.bucket}/${key}`;
  }

  /**
   * Check if tile exists in S3
   */
  async hasTile(z: number, x: number, y: number, format: string = "png"): Promise<boolean> {
    try {
      const key = this.getTileKey(z, x, y, format);
      await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
      return true;
    }
    catch (error: any) {
      if (error.name === "NotFound") {
        return false;
      }
      throw error;
    }
  }

  /**
   * Save tile to S3 cache
   */
  async saveTile(z: number, x: number, y: number, tileData: Buffer, format: string = "png", contentType?: string): Promise<void> {
    const key = this.getTileKey(z, x, y, format);

    await this.client.send(new PutObjectCommand({
      Body: tileData,
      Bucket: this.bucket,
      CacheControl: "public, max-age=31536000", // Cache for 1 year
      ContentType: contentType || `image/${format}`,
      Key: key,
    }));
  }

  /**
   * Generate S3 key for tile
   */
  // eslint-disable-next-line unicorn/consistent-class-member-order
  private getTileKey(z: number, x: number, y: number, format: string = "png"): string {
    return `${this.prefix}/${z}/${x}/${y}.${format}`;
  }
}

// Default configuration from environment variables
export function createDefaultStorage(): null | TileStorage {
  // Only enable S3 storage if S3_ENDPOINT is configured or AWS credentials are provided
  const hasS3Config = process.env.S3_ENDPOINT
    || (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

  if (!hasS3Config) {
    return null;
  }

  const config: S3StorageConfig = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    bucket: process.env.S3_BUCKET || "map-tiles",
    endpoint: process.env.S3_ENDPOINT, // For MinIO or other S3-compatible services
    prefix: process.env.S3_PREFIX || "tiles",
    region: process.env.AWS_REGION || "us-east-1",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };

  return new TileStorage(config);
}

export default TileStorage;
