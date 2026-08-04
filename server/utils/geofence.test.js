/* server/utils/geofence.test.js — unit tests for bounding-box + Haversine */

const { withinBoundingBox, haversineMeters, isWithinRadius } = require('./geofence');

let passed = 0;
let failed = 0;

function assert(description, condition) {
  if (condition) {
    console.log(`  ✅ ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}`);
    failed++;
  }
}

function approx(actual, expected, tolerance = 5) {
  return Math.abs(actual - expected) <= tolerance;
}

console.log('\n📍 Geofence Utility Tests\n');

// ── Known reference points ───────────────────────────────────────────────
// Bengaluru city center: 12.9716, 77.5946
const CENTER = { lat: 12.9716, lng: 77.5946 };
const RADIUS = 50; // meters

// ── Haversine distance tests ─────────────────────────────────────────────
// Same point → 0m
const d0 = haversineMeters(CENTER.lat, CENTER.lng, CENTER.lat, CENTER.lng);
assert('same point → 0 meters', d0 === 0);

// Known distance: ~111km per degree latitude
// 0.001 degree lat ≈ 111.32m
const d1 = haversineMeters(CENTER.lat, CENTER.lng, CENTER.lat + 0.001, CENTER.lng);
assert('0.001° lat north ≈ 111m (±5m tolerance)', approx(d1, 111.32, 5));

// ~45m north (within 50m radius)
const d2 = haversineMeters(CENTER.lat, CENTER.lng, CENTER.lat + 0.0004, CENTER.lng);
assert('0.0004° lat ≈ 44.5m (should be within 50m)', d2 <= 50);

// ~150m north (outside 50m radius)
const d3 = haversineMeters(CENTER.lat, CENTER.lng, CENTER.lat + 0.00135, CENTER.lng);
assert('0.00135° lat ≈ 150m (should be outside 50m)', d3 > 50);

// ── Bounding box tests ───────────────────────────────────────────────────
// Exact center → inside
assert('center point is within bounding box', withinBoundingBox(CENTER.lat, CENTER.lng, CENTER.lat, CENTER.lng, RADIUS));

// ~45m north → inside bounding box
assert('point 45m away is within bounding box', withinBoundingBox(CENTER.lat + 0.0004, CENTER.lng, CENTER.lat, CENTER.lng, RADIUS));

// ~200m north → outside bounding box
assert('point 200m away is outside bounding box', !withinBoundingBox(CENTER.lat + 0.0018, CENTER.lng, CENTER.lat, CENTER.lng, RADIUS));

// ── isWithinRadius combined tests ────────────────────────────────────────
const session = { location: CENTER, radiusMeters: RADIUS };

// Inside (30m away)
assert('student 30m away → isWithinRadius=true', isWithinRadius(CENTER.lat + 0.00027, CENTER.lng, session));

// Outside (200m away)
assert('student 200m away → isWithinRadius=false', !isWithinRadius(CENTER.lat + 0.0018, CENTER.lng, session));

// Edge: exactly at radius boundary — Haversine should place them just inside
const exactBoundaryLat = CENTER.lat + (RADIUS / 111320);
const distAtBoundary = haversineMeters(exactBoundaryLat, CENTER.lng, CENTER.lat, CENTER.lng);
assert(`point at exactly ${RADIUS}m latitude boundary → within radius (dist: ${Math.round(distAtBoundary)}m)`,
  isWithinRadius(exactBoundaryLat, CENTER.lng, session));

// Diagonal corner of bounding box — corners are OUTSIDE the circle (Haversine catches it)
const cornerLat = CENTER.lat + (RADIUS / 111320);
const cornerLng = CENTER.lng + (RADIUS / (111320 * Math.cos(CENTER.lat * Math.PI / 180)));
const cornerDist = haversineMeters(cornerLat, cornerLng, CENTER.lat, CENTER.lng);
assert(`bounding-box corner (dist: ${Math.round(cornerDist)}m) is correctly rejected by Haversine`,
  !isWithinRadius(cornerLat, cornerLng, session));

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
