import { buildApp } from './app.js';
import { config } from './lib/config.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { closeQueues } from './lib/queues.js';
import { reclaimPendingAlbyOrders, syncCanonicalPlans } from './lib/billing.js';

async function main() {
  const app = await buildApp();
  await syncCanonicalPlans().catch((err) => logger.warn({ err }, 'plan sync skipped'));
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT, provider: config.META_PROVIDER }, 'API listening');

  const reclaimMs = Math.max(15_000, Number(process.env.ALBY_RECLAIM_INTERVAL_MS || 45_000));
  const reclaimTimer = setInterval(() => {
    void reclaimPendingAlbyOrders(Number(process.env.ALBY_RECLAIM_BATCH || 20)).then((r) => {
      if (r.activated > 0) logger.info(r, 'alby orders reclaimed');
    });
  }, reclaimMs);
  reclaimTimer.unref?.();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    clearInterval(reclaimTimer);
    await app.close();
    await closeQueues();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal(err, 'failed to start API');
  process.exit(1);
});
