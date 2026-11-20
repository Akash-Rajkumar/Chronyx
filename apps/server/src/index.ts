import dotenv from 'dotenv';
dotenv.config();

import { createServer } from './server.js';
import { logger } from './logger.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const { server } = createServer();

server.listen(PORT, () => {
  logger.info(`Chronyx Hub Server running on http://localhost:${PORT}`);
  logger.info(`Mock mode: ${process.env.USE_MOCKS === '1' ? 'ENABLED' : 'DISABLED'}`);
});

