/**
 * GCJ-02 Coordinate System Implementation
 * 
 * This module provides coordinate transformation utilities between different coordinate systems,
 * specifically for handling China's GCJ-02 (Mars Coordinates) coordinate system.
 * 
 * GCJ-02 is a geodetic datum used by China that adds random offsets to WGS84 coordinates
 * for national security purposes. This implementation provides accurate transformations
 * between WGS84, GCJ-02, and Mercator projections.
 */

import * as proj from "ol/proj.js";

/**
 * Function type for transforming individual points within coordinate arrays
 * @param input - Input coordinate array
 * @param output - Output coordinate array (modified in place)
 * @param offset - Current offset within the arrays
 */
interface PointTransformFunction {
  (input: number[], output: number[], offset: number): void;
}

/**
 * Function type for transforming entire coordinate arrays
 * @param input - Input coordinate array
 * @param opt_output - Optional pre-allocated output array
 * @param opt_dimension - Optional dimension (defaults to 2 for [lng, lat])
 * @returns Transformed coordinate array
 */
interface ForEachPointFunction {
  (input: number[], opt_output?: number[], opt_dimension?: number): number[];
}

/**
 * Creates a higher-order function that applies a point transformation to coordinate arrays
 * 
 * @param func - The point transformation function to apply to each coordinate
 * @returns A function that transforms entire coordinate arrays
 * 
 * @example
 * const transform = forEachPoint((input, output, offset) => {
 *   output[offset] = input[offset] + 1; // Shift longitude
 *   output[offset + 1] = input[offset + 1] + 1; // Shift latitude
 * });
 * 
 * const coords = [120.0, 30.0, 121.0, 31.0];
 * const transformed = transform(coords); // [121.0, 31.0, 122.0, 32.0]
 */
function forEachPoint(func: PointTransformFunction): ForEachPointFunction {
  return (input: number[], opt_output?: number[], opt_dimension?: number): number[] => {
    const len = input.length;
    const dimension = opt_dimension ?? 2;
    let output: number[];

    if (opt_output) {
      output = opt_output;
    }
    else {
      if (dimension !== 2) {
        output = input.slice();
      }
      else {
        output = Array.from({ length: len });
      }
    }

    for (let offset = 0; offset < len; offset += dimension) {
      func(input, output, offset);
    }
    return output;
  };
}

/**
 * GCJ-02 coordinate transformation interface
 */
interface GCJ02Transform {
  /** Transform from GCJ-02 to WGS84 */
  toWGS84: ForEachPointFunction;
  /** Transform from WGS84 to GCJ-02 */
  fromWGS84: ForEachPointFunction;
}

/** GCJ-02 transformation functions container */
const gcj02: GCJ02Transform = {} as GCJ02Transform;

/** Mathematical constant π */
const PI = Math.PI;

/** Semi-major axis of the ellipsoid (meters) */
const AXIS = 6378245.0;

/** Ellipsoid flattening parameter: (a² - b²) / a² */
// eslint-disable-next-line no-loss-of-precision
const OFFSET = 0.00669342162296594323;

/**
 * Calculates the coordinate offset (delta) between WGS84 and GCJ-02 for a given point
 * 
 * This implements the core transformation algorithm that accounts for the
 * systematic offset introduced by the GCJ-02 coordinate system.
 * 
 * @param wgLon - WGS84 longitude
 * @param wgLat - WGS84 latitude
 * @returns Offset as [longitude_delta, latitude_delta]
 * 
 * @internal
 */
function delta(wgLon: number, wgLat: number): [number, number] {
  const dLat = transformLat(wgLon - 105.0, wgLat - 35.0);
  const dLon = transformLon(wgLon - 105.0, wgLat - 35.0);
  const radLat = (wgLat / 180.0) * PI;
  const magic = Math.sin(radLat);
  const magicSquared = 1 - OFFSET * magic * magic;
  const sqrtMagic = Math.sqrt(magicSquared);

  const dLatResult = (dLat * 180.0) / (((AXIS * (1 - OFFSET)) / (magicSquared * sqrtMagic)) * PI);
  const dLonResult = (dLon * 180.0) / ((AXIS / sqrtMagic) * Math.cos(radLat) * PI);

  return [dLonResult, dLatResult];
}

/**
 * Determines if a coordinate is outside China's transformation zone
 * 
 * Coordinates outside China don't need GCJ-02 transformation as the
 * offset algorithm only applies within Chinese territorial boundaries.
 * 
 * @param lon - Longitude
 * @param lat - Latitude
 * @returns true if coordinate is outside China, false if inside
 * 
 * @internal
 */
function outOfChina(lon: number, lat: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

/**
 * Calculates latitude component of the GCJ-02 transformation offset
 * 
 * This implements the latitude-specific part of the Chinese coordinate
 * transformation algorithm using polynomial and trigonometric functions.
 * 
 * @param x - Delta longitude from reference point (105°E)
 * @param y - Delta latitude from reference point (35°N)
 * @returns Latitude offset in arcseconds
 * 
 * @internal
 */
function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

/**
 * Calculates longitude component of the GCJ-02 transformation offset
 * 
 * This implements the longitude-specific part of the Chinese coordinate
 * transformation algorithm using polynomial and trigonometric functions.
 * 
 * @param x - Delta longitude from reference point (105°E)
 * @param y - Delta latitude from reference point (35°N)
 * @returns Longitude offset in arcseconds
 * 
 * @internal
 */
function transformLon(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

/**
 * Transform coordinates from GCJ-02 to WGS84
 * 
 * Removes the GCJ-02 offset from coordinates to get back to standard WGS84.
 * Coordinates outside China are returned unchanged.
 * 
 * @param input - Input coordinate array in GCJ-02 format
 * @param opt_output - Optional pre-allocated output array
 * @param opt_dimension - Optional dimension (defaults to 2)
 * @returns WGS84 coordinate array
 * 
 * @example
 * const gcjCoords = [121.473701, 31.230416]; // Shanghai in GCJ-02
 * const wgsCoords = gcj02.toWGS84(gcjCoords); // Shanghai in WGS84
 */
gcj02.toWGS84 = forEachPoint((input: number[], output: number[], offset: number): void => {
  const lng = input[offset];
  const lat = input[offset + 1];
  if (!outOfChina(lng, lat)) {
    const deltaD = delta(lng, lat);
    output[offset] = lng + deltaD[0];
    output[offset + 1] = lat + deltaD[1];
  }
  else {
    output[offset] = lng;
    output[offset + 1] = lat;
  }
});

/**
 * Transform coordinates from WGS84 to GCJ-02
 * 
 * Applies the GCJ-02 offset to standard WGS84 coordinates.
 * Coordinates outside China are returned unchanged.
 * 
 * @param input - Input coordinate array in WGS84 format
 * @param opt_output - Optional pre-allocated output array
 * @param opt_dimension - Optional dimension (defaults to 2)
 * @returns GCJ-02 coordinate array
 * 
 * @example
 * const wgsCoords = [121.473701, 31.230416]; // Shanghai in WGS84
 * const gcjCoords = gcj02.fromWGS84(wgsCoords); // Shanghai in GCJ-02
 */
gcj02.fromWGS84 = forEachPoint((input: number[], output: number[], offset: number): void => {
  const lng = input[offset];
  const lat = input[offset + 1];
  if (!outOfChina(lng, lat)) {
    const deltaD = delta(lng, lat);
    output[offset] = lng - deltaD[0];
    output[offset + 1] = lat - deltaD[1];
  }
  else {
    output[offset] = lng;
    output[offset + 1] = lat;
  }
});

/**
 * Spherical Mercator projection utilities
 */
interface SphericalMercator {
  /** Transform from longitude/latitude to spherical Mercator */
  forward: ForEachPointFunction;
  /** Transform from spherical Mercator to longitude/latitude */
  inverse: ForEachPointFunction;
}

/** Spherical Mercator projection instance */
const sphericalMercator: SphericalMercator = {} as SphericalMercator;

/** Earth's radius in meters (WGS84 sphere) */
const RADIUS = 6378137;

/** Maximum latitude for Web Mercator projection (≈85.05113°) */
const MAX_LATITUDE = 85.0511287798;

/** Conversion factor from degrees to radians */
const RAD_PER_DEG = Math.PI / 180;

/**
 * Forward spherical Mercator projection
 * 
 * Transforms geographic coordinates (longitude, latitude) to Web Mercator
 * projected coordinates (meters). Clips latitudes to prevent projection
 * singularities at the poles.
 * 
 * @param input - Input coordinate array [longitude, latitude]
 * @param output - Output coordinate array [x, y] in meters
 * @param offset - Current offset within the arrays
 * 
 * @internal
 */
sphericalMercator.forward = forEachPoint((input: number[], output: number[], offset: number): void => {
  const lat = Math.max(Math.min(MAX_LATITUDE, input[offset + 1]), -MAX_LATITUDE);
  const sin = Math.sin(lat * RAD_PER_DEG);

  output[offset] = RADIUS * input[offset] * RAD_PER_DEG;
  output[offset + 1] = (RADIUS * Math.log((1 + sin) / (1 - sin))) / 2;
});

/**
 * Inverse spherical Mercator projection
 * 
 * Transforms Web Mercator projected coordinates (meters) back to
 * geographic coordinates (longitude, latitude).
 * 
 * @param input - Input coordinate array [x, y] in meters
 * @param output - Output coordinate array [longitude, latitude]
 * @param offset - Current offset within the arrays
 * 
 * @internal
 */
sphericalMercator.inverse = forEachPoint((input: number[], output: number[], offset: number): void => {
  output[offset] = input[offset] / RADIUS / RAD_PER_DEG;
  output[offset + 1] = (2 * Math.atan(Math.exp(input[offset + 1] / RADIUS)) - Math.PI / 2) / RAD_PER_DEG;
});

/**
 * Projection transformation utilities combining coordinate system conversions
 * 
 * This interface provides functions that chain multiple transformations together,
 * such as WGS84 → GCJ-02 → Mercator and their inverses.
 */
interface ProjZH {
  /** Transform WGS84 longitude/latitude to GCJ-02 Mercator */
  ll2gmerc: ForEachPointFunction;
  /** Transform GCJ-02 Mercator to WGS84 longitude/latitude */
  gmerc2ll: ForEachPointFunction;
  /** Transform standard Mercator to GCJ-02 Mercator */
  smerc2gmerc: ForEachPointFunction;
  /** Transform GCJ-02 Mercator to standard Mercator */
  gmerc2smerc: ForEachPointFunction;
  /** Transform WGS84 longitude/latitude to standard Mercator */
  ll2smerc: ForEachPointFunction;
  /** Transform standard Mercator to WGS84 longitude/latitude */
  smerc2ll: ForEachPointFunction;
}

/** Projection transformation utilities instance */
const projzh: ProjZH = {} as ProjZH;

/**
 * Transform WGS84 longitude/latitude to GCJ-02 Mercator
 * 
 * Chains WGS84 → GCJ-02 → Mercator transformations for use with OpenLayers.
 * 
 * @param input - Input coordinate array in WGS84 format
 * @param opt_output - Optional pre-allocated output array
 * @param opt_dimension - Optional dimension (defaults to 2)
 * @returns GCJ-02 Mercator projected coordinates
 */
projzh.ll2gmerc = (input: number[], opt_output?: number[], opt_dimension?: number): number[] => {
  const output = gcj02.fromWGS84(input, opt_output, opt_dimension);
  return projzh.ll2smerc(output, output, opt_dimension);
};

/**
 * Transform GCJ-02 Mercator to WGS84 longitude/latitude
 * 
 * Chains Mercator → GCJ-02 → WGS84 transformations for use with OpenLayers.
 * 
 * @param input - Input coordinate array in GCJ-02 Mercator format
 * @param opt_output - Optional pre-allocated output array
 * @param opt_dimension - Optional dimension (defaults to 2)
 * @returns WGS84 geographic coordinates
 */
projzh.gmerc2ll = (input: number[], opt_output?: number[], opt_dimension?: number): number[] => {
  const output = projzh.smerc2ll(input, input, opt_dimension);
  return gcj02.toWGS84(output, output, opt_dimension);
};

/**
 * Transform standard Mercator to GCJ-02 Mercator
 * 
 * @param input - Input coordinate array in standard Mercator format
 * @param opt_output - Optional pre-allocated output array
 * @param opt_dimension - Optional dimension (defaults to 2)
 * @returns GCJ-02 Mercator projected coordinates
 */
projzh.smerc2gmerc = (input: number[], opt_output?: number[], opt_dimension?: number): number[] => {
  let output = projzh.smerc2ll(input, input, opt_dimension);
  output = gcj02.fromWGS84(output, output, opt_dimension);
  return projzh.ll2smerc(output, output, opt_dimension);
};

/**
 * Transform GCJ-02 Mercator to standard Mercator
 * 
 * @param input - Input coordinate array in GCJ-02 Mercator format
 * @param opt_output - Optional pre-allocated output array
 * @param opt_dimension - Optional dimension (defaults to 2)
 * @returns Standard Mercator projected coordinates
 */
projzh.gmerc2smerc = (input: number[], opt_output?: number[], opt_dimension?: number): number[] => {
  let output = projzh.smerc2ll(input, input, opt_dimension);
  output = gcj02.toWGS84(output, output, opt_dimension);
  return projzh.ll2smerc(output, output, opt_dimension);
};

/** Standard Mercator forward projection (WGS84 → Mercator) */
projzh.ll2smerc = sphericalMercator.forward;

/** Standard Mercator inverse projection (Mercator → WGS84) */
projzh.smerc2ll = sphericalMercator.inverse;

/**
 * GCJ-02 projection extent in Web Mercator meters
 * 
 * Defines the valid coordinate range for GCJ-02 Mercator projection,
 * matching the standard Web Mercator extent.
 */
const gcj02Extent: [number, number, number, number] = [
  -20037508.342789244, // West boundary
  -20037508.342789244, // South boundary
  20037508.342789244,  // East boundary
  20037508.342789244,  // North boundary
];

/**
 * GCJ-02 projection instance for OpenLayers
 * 
 * This projection allows OpenLayers to work with GCJ-02 coordinates
 * directly, enabling proper display of Chinese map services.
 */
const gcj02Mecator = new proj.Projection({
  code: "GCJ-02",
  extent: gcj02Extent,
  units: "m",
});

// Register GCJ-02 projection with OpenLayers
proj.addProjection(gcj02Mecator);

/**
 * Register coordinate transformation from WGS84 (EPSG:4326) to GCJ-02 Mercator
 * 
 * Enables OpenLayers to automatically transform geographic coordinates
 * to GCJ-02 Mercator when using this projection.
 */
proj.addCoordinateTransforms(
  "EPSG:4326",     // Source: WGS84 geographic coordinates
  gcj02Mecator,    // Target: GCJ-02 Mercator projection
  projzh.ll2gmerc, // Forward transformation
  projzh.gmerc2ll, // Inverse transformation
);

/**
 * Register coordinate transformation from Web Mercator (EPSG:3857) to GCJ-02 Mercator
 * 
 * Enables OpenLayers to automatically transform Web Mercator coordinates
 * to GCJ-02 Mercator when using this projection.
 */
proj.addCoordinateTransforms(
  "EPSG:3857",     // Source: Web Mercator
  gcj02Mecator,    // Target: GCJ-02 Mercator projection
  projzh.smerc2gmerc, // Forward transformation
  projzh.gmerc2smerc, // Inverse transformation
);

/**
 * Default export: GCJ-02 projection instance
 * 
 * This projection can be used directly with OpenLayers to display
 * Chinese map data that uses the GCJ-02 coordinate system.
 * 
 * @example
 * import gcj02Projection from './gcj02';
 * 
 * // Use with OpenLayers
 * const map = new Map({
 *   view: new View({
 *     projection: gcj02Projection,
 *     center: [121.473701, 31.230416], // Shanghai
 *     zoom: 10
 *   })
 * });
 */
export default gcj02Mecator;
