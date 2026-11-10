// Restores a dump directory into a target database, then reports per-collection counts.
// Usage: node restore.cjs <dumpDir> [--uri URI] [--db NAME] [--drop]
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

const args = process.argv.slice(2);
const dir = args[0];
if (!dir || !fs.existsSync(dir)) {
  console.error('usage: node restore.cjs <dumpDir> [--uri URI] [--db NAME] [--drop]');
  process.exit(1);
}
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
};

const uri = argOf('--uri', process.env.MONGO_URI || 'mongodb://127.0.0.1:27017');
const dbName = argOf('--db', 'LibreChatRestore');
const drop = args.includes('--drop');

(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  try {
    const db = client.db(dbName);
    if (drop) {
      await db.dropDatabase();
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'meta.json');
    const counts = {};
    for (const file of files) {
      const name = file.slice(0, -'.json'.length);
      const docs = EJSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (docs.length === 0) {
        counts[name] = 0;
        continue;
      }
      await db.collection(name).insertMany(docs);
      counts[name] = docs.length;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(JSON.stringify({ db: dbName, collections: files.length, total }, null, 2));
    const spot = await db.collection('agents').find({}).toArray();
    console.log('restored agents:', spot.map((a) => `${a.id} ${a.name}`).join(', ') || '(none)');
  } finally {
    await client.close();
  }
})().catch((error) => {
  console.error('RESTORE FAILED', error.message);
  process.exit(1);
});
