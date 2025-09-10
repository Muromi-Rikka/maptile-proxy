// Import proj control, use its methods to inject gcj02 coordinate system
import * as proj from "ol/proj.js";

// Define types
export type CoordinateTransformFunction = (
  input: number[],
  output?: number[],
  dimension?: number
) => number[];

// GCJ-02 coordinate system conversion constants
const GCJ02_CONSTANTS = {
  PI: Math.PI,
  AXIS: 6378245.0, // Semi-major axis
  // eslint-disable-next-line no-loss-of-precision
  OFFSET: 0.00669342162296594323, // (a^2 - b^2) / a^2
} as const;

// Spherical Mercator projection constants
const SPHERICAL_MERCATOR_CONSTANTS = {
  RADIUS: 6378137,
  MAX_LATITUDE: 85.0511287798,
  RAD_PER_DEG: Math.PI / 180,
} as const;

/**
 * Traverse point coordinates and apply transformation function
 */
function forEachPoint(transformFunc: (input: number[], output: number[], offset: number) => void): CoordinateTransformFunction {
  return function (input: number[], opt_output?: number[], opt_dimension?: number): number[] {
    const len = input.length;
    const dimension = opt_dimension || 2;
    let output: number[];

    if (opt_output) {
      output = opt_output;
    }
    else {
      if (dimension !== 2) {
        output = input.slice();
      }
      else {
        output = Array.from({ length: len }) as number[];
      }
    }

    for (let offset = 0; offset < len; offset += dimension) {
      transformFunc(input, output, offset);
    }
    return output;
  };
}

/**
 * Calculate WGS84 to GCJ-02 offset
 */
function delta(wgLon: number, wgLat: number): [number, number] {
  const { PI, AXIS, OFFSET } = GCJ02_CONSTANTS;
  let dLat = transformLat(wgLon - 105.0, wgLat - 35.0);
  let dLon = transformLon(wgLon - 105.0, wgLat - 35.0);
  const radLat = (wgLat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - OFFSET * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((AXIS * (1 - OFFSET)) / (magic * sqrtMagic)) * PI);
  dLon = (dLon * 180.0) / ((AXIS / sqrtMagic) * Math.cos(radLat) * PI);
  return [dLon, dLat];
}

/**
 * Check if coordinates are outside China
 */
function outOfChina(lon: number, lat: number): boolean {
  if (lon < 72.004 || lon > 137.8347) {
    return true;
  }
  if (lat < 0.8293 || lat > 55.8271) {
    return true;
  }
  return false;
}

/**
 * Latitude transformation function
 */
function transformLat(x: number, y: number): number {
  const { PI } = GCJ02_CONSTANTS;
  let ret = -100.0
    + 2.0 * x
    + 3.0 * y
    + 0.2 * y * y
    + 0.1 * x * y
    + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

/**
 * Longitude transformation function
 */
function transformLon(x: number, y: number): number {
  const { PI } = GCJ02_CONSTANTS;
  let ret = 300.0
    + x
    + 2.0 * y
    + 0.1 * x * x
    + 0.1 * x * y
    + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

// GCJ-02 coordinate system conversion object
const gcj02 = {
  /**
   * Convert GCJ-02 coordinates to WGS84 coordinates
   */
  toWGS84: forEachPoint((input: number[], output: number[], offset: number): void => {
    const lng = input[offset]!;
    const lat = input[offset + 1]!;
    if (!outOfChina(lng, lat)) {
      const deltaD = delta(lng, lat);
      output[offset] = lng - deltaD[0];
      output[offset + 1] = lat - deltaD[1];
    }
    else {
      output[offset] = lng;
      output[offset + 1] = lat;
    }
  }),

  /**
   * Convert WGS84 coordinates to GCJ-02 coordinates
   */
  fromWGS84: forEachPoint((input: number[], output: number[], offset: number): void => {
    const lng = input[offset]!;
    const lat = input[offset + 1]!;
    if (!outOfChina(lng, lat)) {
      const deltaD = delta(lng, lat);
      output[offset] = lng + deltaD[0];
      output[offset + 1] = lat + deltaD[1];
    }
    else {
      output[offset] = lng;
      output[offset + 1] = lat;
    }
  }),
};

// Spherical Mercator projection object
const sphericalMercator = {
  /**
   * Convert latitude and longitude to spherical Mercator coordinates
   */
  forward: forEachPoint((input: number[], output: number[], offset: number): void => {
    const { RADIUS, MAX_LATITUDE, RAD_PER_DEG } = SPHERICAL_MERCATOR_CONSTANTS;
    const lat = Math.max(Math.min(MAX_LATITUDE, input[offset + 1]!), -MAX_LATITUDE);
    const sin = Math.sin(lat * RAD_PER_DEG);

    output[offset] = RADIUS * input[offset]! * RAD_PER_DEG;
    output[offset + 1] = (RADIUS * Math.log((1 + sin) / (1 - sin))) / 2;
  }),

  /**
   * Convert spherical Mercator coordinates to latitude and longitude
   */
  inverse: forEachPoint((input: number[], output: number[], offset: number): void => {
    const { RADIUS, RAD_PER_DEG } = SPHERICAL_MERCATOR_CONSTANTS;
    output[offset] = input[offset]! / RADIUS / RAD_PER_DEG;
    output[offset + 1] = (2 * Math.atan(Math.exp(input[offset + 1]! / RADIUS)) - Math.PI / 2) / RAD_PER_DEG;
  }),
};

// Coordinate transformation object
const projzh = {
  /**
   * Convert latitude and longitude to GCJ-02 Mercator coordinates
   */
  ll2gmerc(input: number[], opt_output?: number[], opt_dimension?: number): number[] {
    const output = gcj02.fromWGS84(input, opt_output, opt_dimension);
    return projzh.ll2smerc(output, output, opt_dimension);
  },

  /**
   * Convert GCJ-02 Mercator coordinates to latitude and longitude
   */
  gmerc2ll(input: number[], opt_output?: number[], opt_dimension?: number): number[] {
    const output = projzh.smerc2ll(input, input, opt_dimension);
    return gcj02.toWGS84(output, opt_output, opt_dimension);
  },

  /**
   * Convert standard Mercator coordinates to GCJ-02 Mercator coordinates
   */
  smerc2gmerc(input: number[], opt_output?: number[], opt_dimension?: number): number[] {
    let output = projzh.smerc2ll(input, input, opt_dimension);
    output = gcj02.fromWGS84(output, output, opt_dimension);
    return projzh.ll2smerc(output, output, opt_dimension);
  },

  /**
   * Convert GCJ-02 Mercator coordinates to standard Mercator coordinates
   */
  gmerc2smerc(input: number[], opt_output?: number[], opt_dimension?: number): number[] {
    let output = projzh.smerc2ll(input, input, opt_dimension);
    output = gcj02.toWGS84(output, output, opt_dimension);
    return projzh.ll2smerc(output, output, opt_dimension);
  },

  /**
   * Convert latitude and longitude to standard Mercator coordinates
   */
  ll2smerc: sphericalMercator.forward,

  /**
   * Convert standard Mercator coordinates to latitude and longitude
   */
  smerc2ll: sphericalMercator.inverse,
};

// Define GCJ02 projection extent
const gcj02Extent: [number, number, number, number] = [
  -20037508.342789244,
  -20037508.342789244,
  20037508.342789244,
  20037508.342789244,
];

// Create GCJ-02 projection object
const gcj02Mecator = new proj.Projection({
  code: "GCJ-02",
  extent: gcj02Extent,
  units: "m",
});

// Add projection definition
proj.addProjection(gcj02Mecator);

// Add coordinate transformation functions (WGS84 <-> GCJ-02)
proj.addCoordinateTransforms(
  "EPSG:4326",
  gcj02Mecator,
  projzh.ll2gmerc,
  projzh.gmerc2ll,
);

// Add coordinate transformation functions (Standard Mercator <-> GCJ-02 Mercator)
proj.addCoordinateTransforms(
  "EPSG:3857",
  gcj02Mecator,
  projzh.smerc2gmerc,
  projzh.gmerc2smerc,
);

// Export GCJ-02 projection object for external use
export default gcj02Mecator;
