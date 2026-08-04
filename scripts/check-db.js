require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

async function checkCloudConnection() {
  console.log('🔍 Testing connection to MongoDB Atlas Cloud...');
  console.log('  Target URI:', MONGODB_URI ? MONGODB_URI.replace(/:([^@]+)@/, ':****@') : 'MISSING');

  const start = Date.now();
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 6000 });
    const elapsed = Date.now() - start;

    console.log(`\n✅ CONNECTED TO MONGODB ATLAS CLOUD (${elapsed}ms)!`);
    console.log('  Database Name:', mongoose.connection.name);
    console.log('  Host:', mongoose.connection.host);
    console.log('  Port:', mongoose.connection.port);
    console.log('  Ready State:', mongoose.connection.readyState === 1 ? 'Connected (1)' : mongoose.connection.readyState);

    const collections = await mongoose.connection.db.collections();
    console.log(`\n📁 Total Collections in Cloud DB: ${collections.length}`);
    for (let col of collections) {
      const count = await col.countDocuments();
      console.log(`  └─ Collection '${col.collectionName}': ${count} document(s)`);
    }

    await mongoose.connection.close();
    console.log('\n🔒 Connection closed cleanly.');
    process.exit(0);
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`\n❌ FAILED TO CONNECT TO MONGODB ATLAS CLOUD (${elapsed}ms)`);
    console.error('  Error Name:', err.name);
    console.error('  Error Message:', err.message);
    console.error('\n💡 Common Causes & Fixes:');
    console.error('  1. IP Whitelist: Your current IP address is not whitelisted in MongoDB Atlas Security settings.');
    console.error('     -> Fix: In MongoDB Atlas Dashboard -> Network Access -> Add IP Address -> Allow Access From Anywhere (0.0.0.0/0).');
    console.error('  2. Network / Firewall: Port 27017 or outbound SSL connections blocked by network router or VPN.');
    console.error('  3. DB User Credentials: Password or username mismatch in .env MONGODB_URI string.');
    process.exit(1);
  }
}

checkCloudConnection();
