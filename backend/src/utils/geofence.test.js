const assert = require('assert');
const { haversineMeters, withinBoundingBox, isWithinRadius } = require('./geofence');

console.log('🧪 Testing Geofence Calculations...');

const centerLat = 12.9716;
const centerLng = 77.5946;

// Exact same coordinates -> 0m
const distZero = haversineMeters(centerLat, centerLng, centerLat, centerLng);
assert.strictEqual(Math.round(distZero), 0);
assert.strictEqual(withinBoundingBox(centerLat, centerLng, centerLat, centerLng, 50), true);
assert.strictEqual(isWithinRadius(centerLat, centerLng, centerLat, centerLng, 50), true);

// Far coordinates (e.g. Delhi vs Bengaluru) -> ~1700km
const delhiLat = 28.6139;
const delhiLng = 77.2090;
assert.strictEqual(withinBoundingBox(delhiLat, delhiLng, centerLat, centerLng, 50), false);
assert.strictEqual(isWithinRadius(delhiLat, delhiLng, centerLat, centerLng, 50), false);

console.log('✅ Geofence tests passed');
