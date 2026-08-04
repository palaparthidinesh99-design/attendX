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
 * Only called after bounding-box pre-check passes.
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
 * Fail-fast: if bounding box rejects, we never run the trig.
 *
 * @param {number} studentLat
 * @param {number} studentLng
 * @param {object} session    - Mongoose Session document with .location and .radiusMeters
 * @returns {boolean}
 */
function isWithinRadius(studentLat, studentLng, session) {
  const { lat: cLat, lng: cLng } = session.location;
  const radius = session.radiusMeters || 50;

  if (!withinBoundingBox(studentLat, studentLng, cLat, cLng, radius)) {
    return false; // cheap rejection — skip trig entirely
  }

  return haversineMeters(studentLat, studentLng, cLat, cLng) <= radius;
}

module.exports = { withinBoundingBox, haversineMeters, isWithinRadius };
