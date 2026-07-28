/**
 * GCJ-02 Coordinate System Implementation
 *
 * Core math for transforming between WGS84 and GCJ-02 (Mars Coordinates).
 * No external dependencies — pure math.
 */

const PI = Math.PI;

/** Semi-major axis of the ellipsoid (meters) */
const AXIS = 6378245.0;

/** Ellipsoid flattening parameter: (a² - b²) / a² */
// eslint-disable-next-line no-loss-of-precision
const OFFSET = 0.00669342162296594323;

/**
 * Determines if a coordinate is outside China's transformation zone.
 */
function outOfChina(lon: number, lat: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

/**
 * Latitude component of the GCJ-02 transformation offset.
 */
function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

/**
 * Longitude component of the GCJ-02 transformation offset.
 */
function transformLon(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

/**
 * Calculate the GCJ-02 coordinate offset (delta) for a given WGS84 point.
 *
 * @param wgLon - WGS84 longitude
 * @param wgLat - WGS84 latitude
 * @returns Offset as [longitude_delta, latitude_delta]
 */
export function delta(wgLon: number, wgLat: number): [number, number] {
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

export { outOfChina };
