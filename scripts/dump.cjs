// Dumps every collection to EJSON files, then verifies the dump can be read back.
// Usage: node dump.cjs [--out DIR] [--uri URI]
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
};

const uri = argOf('--uri', process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/LibreChat');
const outRoot = argOf('--out', process.env.LIBRECHAT_BACKUP_DIR || 'D:/LibreChatData/backups');
const keep = Number(argOf('--keep', '14'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(outRoot, stamp);

/** Deletes all but the newest `count` dump directories under `root`. */
function pruneOldDumps(root, count) {
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const doomed = dirs.slice(0, Math.max(0, dirs.length - count));
  for (const name of doomed) {
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
  return doomed;
}

/** Writes one collection to `<name>.json` and returns its document count. */
async function dumpCollection(db, name, dir) {
  const docs = await db.collection(name).find({}).toArray();
  fs.writeFileSync(path.join(dir, `${name}.json`), EJSON.stringify(docs, { relaxed: false }));
  return docs.length;
}

/** Reads a dump back and compares per-collection counts against the live database. */
async function verify(client, dir) {
  const db = client.db();
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'meta.json');
  const problems = [];
  let total = 0;
  for (const file of files) {
    const name = file.slice(0, -'.json'.length);
    const parsed = EJSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (!Array.isArray(parsed)) {
      problems.push(`${name}: not an array`);
      continue;
    }
    const live = await db.collection(name).countDocuments();
    total += parsed.length;
    if (parsed.length !== live) {
      problems.push(`${name}: dump ${parsed.length} vs live ${live}`);
    }
  }
  return { files: files.length, total, problems };
}

/** Copies a dump to `LIBRECHAT_BACKUP_MIRROR` when set. Never fails the run: the local
 *  verified dump is the backup, the mirror is a second copy. A mirror on the same physical
 *  disk survives file loss but not disk failure, so the target must be documented as such. */
function mirrorOffsite(dir) {
  const target = process.env.LIBRECHAT_BACKUP_MIRROR;
  if (!target || target.trim() === '') {
    return;
  }
  const destination = path.join(target, path.basename(dir));
  try {
    fs.mkdirSync(destination, { recursive: true });
    fs.cpSync(dir, destination, { recursive: true });
    console.log(`mirrored to ${destination}`);
  } catch (error) {
    console.error(`MIRROR FAILED ${destination}: ${error.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  try {
    const db = client.db();
    fs.mkdirSync(outDir, { recursive: true });

    const names = (await db.listCollections().toArray())
      .map((c) => c.name)
      .filter((n) => !n.startsWith('system.'));

    const counts = {};
    for (const name of names) {
      counts[name] = await dumpCollection(db, name, outDir);
    }

    const meta = {
      createdAt: new Date().toISOString(),
      database: db.databaseName,
      collections: counts,
      totalDocuments: Object.values(counts).reduce((a, b) => a + b, 0),
    };
    fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));

    const result = await verify(client, outDir);
    console.log(JSON.stringify({ outDir, ...meta, verify: result }, null, 2));

    if (result.problems.length > 0) {
      console.error('VERIFY FAILED');
      process.exitCode = 1;
    } else {
      fs.writeFileSync(path.join(outRoot, 'LATEST'), outDir);
      const pruned = pruneOldDumps(outRoot, keep);
      if (pruned.length > 0) {
        console.log(`pruned ${pruned.length} old dump(s): ${pruned.join(', ')}`);
      }
      mirrorOffsite(outDir);
    }
  } finally {
    await client.close();
  }
})().catch((error) => {
  console.error('DUMP FAILED', error.message);
  process.exit(1);
});
