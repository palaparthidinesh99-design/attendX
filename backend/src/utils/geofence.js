/**
 * Bounding-box pre-check before expensive Haversine trig.
 * Rejects obviously out-of-range coordinates in O(1) with no trig.
 *
 * @param {number} lat         - Student latitude
 * @param {number} lng         - Student longitude
 * @param {number} centerLat   - Session center latitude
 * @param {number} centerLng   - Session center longitude
 * @param {number} radiusMeters
 * @returns {boolean}
 */
function withinBoundingBox(lat, lng, centerLat, centerLng, radiusMeters) {
  // ~111,320 meters per degree latitude (constant)
  // Longitude degree length shrinks with cos(latitude)
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / (111320 * Math.cos(centerLat * Math.PI / 180));

  return (
    lat >= centerLat - latDelta &&
    lat <= centerLat + latDelta &&
    lng >= centerLng - lngDelta &&
    lng <= centerLng + lngDelta
  );
}

/**
 * Haversine formula — great-circle distance between two lat/lng points.
 *
 * @returns {number} Distance in meters
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Combined geofence check: bounding-box first (O(1)), then Haversine.
 *
 * @param {number} studentLat
 * @param {number} studentLng
 * @param {number} centerLat
 * @param {number} centerLng
 * @param {number} radiusMeters
 * @returns {boolean}
 */
function isWithinRadius(studentLat, studentLng, centerLat, centerLng, radiusMeters = 50) {
  if (!withinBoundingBox(studentLat, studentLng, centerLat, centerLng, radiusMeters)) {
    return false;
  }
  return haversineMeters(studentLat, studentLng, centerLat, centerLng) <= radiusMeters;
}

module.exports = { withinBoundingBox, haversineMeters, isWithinRadius };
