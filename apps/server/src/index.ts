import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Root .env is 2 levels up from apps/server/src: apps/server/src -> apps/server -> repo root
const rootEnvPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: rootEnvPath });
dotenv.config();

import { createServer } from './server.js';
import { logger } from './logger.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const serverInstance = createServer();
const { server, io, orchestrator } = serverInstance;

let isStarted = false;
let isShuttingDown = false;

server.listen(PORT, async () => {
  logger.info(`Chronyx Hub Server running on http://localhost:${PORT}`);
  logger.info(`Mock mode: ${process.env.USE_MOCKS === '1' ? 'ENABLED' : 'DISABLED'}`);

  try {
    await serverInstance.init();
    if (!isStarted) {
      isStarted = true;
      orchestrator.start(1000);
      logger.info('Orchestrator 1 Hz scheduler started');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to initialize server virtual nodes');
    gracefulShutdown('INIT_FAILURE');
  }
});

export function gracefulShutdown(signal: string, callback?: () => void) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'Graceful shutdown initiated');

  try {
    orchestrator.stop();
  } catch (err) {
    logger.error({ err }, 'Error stopping orchestrator');
  }

  io.close(() => {
    logger.info('Socket.IO closed');
  });

  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error closing HTTP server');
      if (callback) callback();
      else process.exit(1);
      return;
    }
    logger.info('HTTP server closed cleanly');
    if (callback) callback();
    else process.exit(0);
  });

  setTimeout(() => {
    logger.warn('Forced shutdown due to timeout');
    if (callback) callback();
    else process.exit(0);
  }, 5000).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));


