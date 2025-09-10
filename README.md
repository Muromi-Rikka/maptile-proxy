# Map Tile Proxy Server

A high-performance map tile proxy server with GCJ-02 coordinate transformation and multi-layer caching support. This service provides properly coordinate-transformed map tiles from various sources with persistent S3 storage and in-memory LRU caching.

## ✨ Features

- **Multi-Layer Caching**: In-memory LRU cache + S3 persistent storage
- **Coordinate Transformation**: WGS84 to GCJ-02 (China Mars Coordinate System)
- **Multiple Map Sources**: Support for Amap, Google Maps, and other tile sources
- **RESTful API**: Clean and intuitive REST API endpoints
- **Docker Support**: Ready-to-use Docker and Docker Compose configurations
- **Health Monitoring**: Built-in health checks and cache statistics
- **Environment Configuration**: Flexible configuration via environment variables
- **TypeScript**: Full TypeScript support with type safety

## 🚀 Quick Start

### Prerequisites

- Node.js (v18 or higher)
- pnpm (package manager)
- AWS S3 or MinIO (for persistent storage - optional)

### Installation

```bash
# Clone repository
git clone <repository-url>
cd maptile

# Install dependencies
pnpm install

# Copy environment configuration
cp .env.example .env

# Edit configuration as needed
vim .env

# Start development server
pnpm dev
```

### Production Build

```bash
# Build the project
pnpm build

# Start production server
pnpm start
```

## 🐳 Docker Deployment

### Using Docker

```bash
# Build image
docker build -t maptile-server .

# Run with basic configuration
docker run -p 5000:5000 \
  -e MAP_SOURCE="https://api.maptiler.com/maps/satellite/{z}/{x}/{y}.jpg?key=YOUR_KEY" \
  -e PORT=5000 \
  -e CACHE_MAX_SIZE=200 \
  -e CACHE_RESET_INTERVAL=60000 \
  -e TILE_LOAD_TIMEOUT=30000 \
  maptile-server

# Run with AWS S3 storage
docker run -p 5000:5000 \
  -e MAP_SOURCE="https://api.maptiler.com/maps/satellite/{z}/{x}/{y}.jpg?key=YOUR_KEY" \
  -e PORT=5000 \
  -e CACHE_MAX_SIZE=500 \
  -e AWS_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=your-access-key \
  -e AWS_SECRET_ACCESS_KEY=your-secret-key \
  -e S3_BUCKET=your-bucket-name \
  -e S3_PREFIX=tiles \
  maptile-server

# Run with MinIO/S3-compatible storage
docker run -p 5000:5000 \
  -e MAP_SOURCE="https://api.maptiler.com/maps/satellite/{z}/{x}/{y}.jpg?key=YOUR_KEY" \
  -e PORT=5000 \
  -e CACHE_MAX_SIZE=200 \
  -e S3_ENDPOINT=http://your-minio-server:9000 \
  -e S3_BUCKET=map-tiles \
  -e AWS_ACCESS_KEY_ID=minioadmin \
  -e AWS_SECRET_ACCESS_KEY=minioadmin \
  -e S3_PREFIX=tiles \
  maptile-server

# Run with environment file
docker run -p 5000:5000 --env-file .env maptile-server
```

## ⚙️ Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure as needed:

#### Basic Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `5000` |
| `MAP_SOURCE` | Map tile source URL template | Amap URL |
| `CACHE_MAX_SIZE` | Maximum in-memory cache size | `200` |
| `CACHE_RESET_INTERVAL` | Cache reset interval (ms) | `60000` |
| `TILE_LOAD_TIMEOUT` | Tile loading timeout (ms) | `30000` |
| `LOG_LEVEL` | Logging level | `info` |

#### S3 Storage Configuration
| Variable | Description | Required |
|----------|-------------|----------|
| `S3_BUCKET` | S3 bucket name for tile storage | ✅ |
| `AWS_REGION` | AWS region | ✅ |
| `AWS_ACCESS_KEY_ID` | AWS access key (optional with IAM) | ❌ |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key (optional with IAM) | ❌ |
| `S3_ENDPOINT` | S3 endpoint (for MinIO/S3-compatible) | ❌ |
| `S3_PREFIX` | S3 key prefix for tiles | `tiles` |

### Example Configurations

#### AWS S3
```bash
# AWS S3
S3_BUCKET=map-tiles-prod
AWS_REGION=us-west-2
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

#### MinIO
```bash
# MinIO
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=map-tiles
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
```

#### Local Development (No S3)
```bash
# Skip S3 - only use in-memory cache
# S3 storage is automatically disabled when neither S3_ENDPOINT nor AWS credentials are provided
```

**Note**: S3 storage is only enabled when at least one of the following is configured:
- `S3_ENDPOINT` (for MinIO or S3-compatible services)
- Both `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (for AWS S3)

When S3 is disabled, the service will only use in-memory LRU caching.

## 📡 API Reference

### Get Map Tile

```http
GET /appmaptile?x={x}&y={y}&z={z}
```

**Parameters:**
- `x` (int): Tile x coordinate
- `y` (int): Tile y coordinate
- `z` (int): Zoom level

**Response:**
- `200 OK`: PNG image
- `400 Bad Request`: Invalid parameters
- `500 Internal Server Error`: Server error

**Example:**
```bash
curl "http://localhost:5000/appmaptile?x=100&y=200&z=10"
```

### Health Check

```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "cacheStats": {
    "size": 150,
    "maxSize": 200,
    "usage": "75%"
  }
}
```

### Cache Statistics

```http
GET /cache-stats
```

**Response (with S3 enabled):**
```json
{
  "lruCache": {
    "size": 150,
    "maxSize": 200,
    "usage": "75%"
  },
  "s3Enabled": true,
  "s3Bucket": "map-tiles",
  "s3Prefix": "tiles",
  "s3Region": "us-east-1"
}
```

**Response (with S3 disabled):**
```json
{
  "lruCache": {
    "size": 150,
    "maxSize": 200,
    "usage": "75%"
  },
  "s3Enabled": false
}
```

### Reset Cache

```http
POST /reset-cache
```

**Response:**
```json
{
  "status": "success",
  "message": "Cache reset successfully",
  "cacheStats": {
    "size": 0,
    "maxSize": 200,
    "usage": "0%"
  }
}
```

### S3 Cache Management

**Note**: S3 cache endpoints are only available when S3 storage is enabled.

#### Check S3 Cache
```http
GET /s3-cache/check?z={z}&x={x}&y={y}
```

**Response (S3 enabled):**
```json
{
  "exists": true,
  "tile": "100-200-10",
  "url": "s3://map-tiles/tiles/10/100/200.png"
}
```

**Response (S3 disabled):**
```json
{
  "error": "S3 storage is not enabled"
}
```

#### Clear S3 Cache
```http
POST /s3-cache/clear?z={z}&x={x}&y={y}
```

**Response (S3 enabled):**
```json
{
  "status": "success",
  "message": "S3 cache cleared for tile 100-200-10"
}
```

**Response (S3 disabled):**
```json
{
  "error": "S3 storage is not enabled"
}
```

## 🔄 Caching Architecture

### Cache Layers
1. **Memory Cache (LRU)**: Fast access for recently used tiles
2. **S3 Storage**: Persistent cache across service restarts
3. **Source**: Original tile provider

### Cache Flow
```
Client Request → Memory Cache → S3 Cache → Source → Save to Caches → Response
```

### Cache Strategy
- **Memory**: 200 tiles max (configurable)
- **S3**: Unlimited persistent storage
- **Async Storage**: S3 writes are non-blocking
- **TTL**: 1-year cache headers for S3

## 🗺️ Coordinate System

### GCJ-02 (Mars Coordinate System)
- **Usage**: Required for Chinese map services
- **Transformation**: WGS84 → GCJ-02
- **Accuracy**: Precise coordinate conversion
- **Boundary**: Smart handling outside China

### Supported Projections
- **EPSG:4326** (WGS84)
- **EPSG:3857** (Web Mercator)
- **GCJ-02** (China Mars)

## 🛠️ Development

### Available Scripts

```bash
# Development
pnpm dev

# Build
pnpm build

# Start production
pnpm start

# Linting
pnpm lint

# Testing
pnpm test
```

### Project Structure
```
maptile/
├── src/
│   ├── index.ts          # Main server
│   ├── storage.ts        # S3 storage implementation
│   └── gcj02.ts         # GCJ-02 coordinate transformation
├── dist/                 # Build output
├── nginx/               # Nginx configuration
├── Dockerfile           # Docker configuration
├── docker-compose.yaml  # Docker Compose setup
└── .env.example         # Environment template
```

## 🔧 Troubleshooting

### Common Issues

#### S3 Connection Problems
```bash
# Check S3 credentials
aws s3 ls s3://your-bucket-name

# Test MinIO connection
curl http://localhost:9000/minio/health/live
```

#### Memory Issues
- Reduce `CACHE_MAX_SIZE` for low-memory environments
- Monitor cache statistics at `/cache-stats`

#### Coordinate Drift
- Verify source URL format
- Check coordinate transformation accuracy

### Debug Mode
```bash
# Enable debug logging
LOG_LEVEL=debug pnpm dev
```

## 📊 Monitoring

### Health Metrics
- Response time tracking
- Cache hit/miss ratios
- S3 storage usage
- Error rates

### Logging
- Structured JSON logs with pino
- Request/response timing
- Error stack traces
- Cache performance metrics

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

ISC License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- OpenLayers for coordinate transformation
- Hono.js for the web framework
- AWS SDK for S3 integration
- GCJ-02 transformation algorithm implementation

## 📞 Support

For issues and questions:
1. Check the troubleshooting section
2. Review existing GitHub issues
3. Create a new issue with detailed information
