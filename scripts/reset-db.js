require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/attendance_system';

async function wipeDatabase() {
  console.log('🧹 Wiping database at:', MONGODB_URI);

  let connectedUri = MONGODB_URI;
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 4000 });
  } catch (atlasErr) {
    console.warn(`⚠️ Atlas connection timeout: ${atlasErr.message}`);
    console.log('🔄 Wiping local MongoDB (mongodb://127.0.0.1:27017/attendance_system)...');
    connectedUri = 'mongodb://127.0.0.1:27017/attendance_system';
    try {
      await mongoose.connect(connectedUri, { serverSelectionTimeoutMS: 4000 });
    } catch (localErr) {
      console.error('❌ Could not connect to Atlas or Local MongoDB to wipe:', localErr.message);
      process.exit(1);
    }
  }

  try {
    const collections = await mongoose.connection.db.collections();
    for (let collection of collections) {
      await collection.deleteMany({});
      console.log(`  └─ Dropped collection: ${collection.collectionName}`);
    }
    console.log(`✅ Database clean at ${connectedUri}!`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to wipe database:', err.message);
    process.exit(1);
  }
}

wipeDatabase();
