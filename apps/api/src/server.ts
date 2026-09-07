import { buildApp } from './app.js';
import { config } from './lib/config.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { closeQueues } from './lib/queues.js';

async function main() {
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT, provider: config.META_PROVIDER }, 'API listening');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
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
