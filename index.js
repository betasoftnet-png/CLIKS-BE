const dotenv = require('dotenv');

// Load environment-specific file if NODE_ENV is set, otherwise default to .env
const envFile = process.env.NODE_ENV ? `.env.${process.env.NODE_ENV}` : '.env';
dotenv.config({ path: envFile });
dotenv.config(); // fallback to standard .env to fill in missing vars

const logger = require('./utils/logger'); // <-- our centralized logger

// ── Guard required env vars before loading anything else ─────────────────────
const REQUIRED_ENV = ['JWT_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.fatal(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// ── Global Error Catching ───────────────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ promise, reason }, 'Unhandled Rejection at Promise');
});

process.on('uncaughtException', (error) => {
  logger.fatal(error, 'Uncaught Exception thrown');
  process.exit(1);
});

const { runMigrations } = require('./db/migrations');
const { seedDefaultUser } = require('./db/seed');
const app = require('./app');

const PORT = parseInt(process.env.PORT || '8000', 10);

async function startServer() {
  try {
    await runMigrations();
    await seedDefaultUser();

    const server = app.listen(PORT, () => {
      logger.info(`🚀 Books & Finance API`);
      logger.info(`   ENV  : ${process.env.NODE_ENV || 'development'}`);
      logger.info(`   URL  : http://localhost:${PORT}/api/v1`);
      logger.info(`   Docs : http://localhost:${PORT}/api-docs`);
    });

    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        logger.fatal(`Port ${PORT} is already in use. Please run: lsof -ti :${PORT} | xargs kill -9`);
        process.exit(1);
      }
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received — shutting down gracefully');
      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received — shutting down');
      server.close(() => process.exit(0));
    });

  } catch (error) {
    logger.fatal(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

startServer();
