import EmbeddedPostgres from 'embedded-postgres';
import { RedisMemoryServer } from 'redis-memory-server';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, '.data', 'pg');
fs.mkdirSync(dataDir, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'pagebroadcast',
  password: 'pagebroadcast',
  port: 5432,
  persistent: true,
});

const redis = new RedisMemoryServer({ instance: { port: 6379 } });

async function main() {
  console.log('Starting embedded Postgres...');
  await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase('pagebroadcast');
  } catch {
    // already exists
  }
  console.log('Postgres ready on localhost:5432/pagebroadcast');

  console.log('Starting Redis memory server...');
  const host = await redis.getHost();
  const port = await redis.getPort();
  console.log(`Redis ready on ${host}:${port}`);
  console.log('INFRA_READY');

  const shutdown = async () => {
    console.log('Stopping infra...');
    try {
      await redis.stop();
    } catch {}
    try {
      await pg.stop();
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
