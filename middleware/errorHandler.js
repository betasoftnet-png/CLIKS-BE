/**
 * middleware/errorHandler.js
 *
 * Centralized Express error handler.
 * Must be registered LAST with app.use(errorHandler).
 *
 * All errors are logged via Pino.
 * In development, stack traces are included in the response.
 */

const logger = require('../utils/logger');
const { captureException } = require('../utils/sentry');
const { ZodError } = require('zod');

function errorHandler(err, req, res, _next) {
  const isDev = process.env.NODE_ENV !== 'production';

  // ── Zod Validation Error ──────────────────────────────────────────────────
  if (err instanceof ZodError) {
    logger.warn(`[ZodValidation] ${req.method} ${req.path} - ${err.errors.map(e => e.message).join(', ')}`);
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Input validation failed', fields: err.errors }
    });
  }

  // ── AppError (Custom Operational Errors) ──────────────────────────────────
  if (err.isOperational) {
    logger.warn({ requestId: req.id, method: req.method, path: req.path }, `[AppError] ${req.method} ${req.path} - ${err.message}`);
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message }
    });
  }

  // Always log unexpected errors
  const requestId = req.id ?? 'unknown';
  logger.error({ requestId, method: req.method, path: req.path, err }, `[Unexpected] ${req.method} ${req.path} — ${err.message}`);
  if (isDev) logger.error(err.stack);

  // Report to Sentry (no-ops if SENTRY_DSN not configured)
  captureException(err, { requestId, method: req.method, path: req.path, userId: req.user?.id });

  // ── express-validator: fallback ───────────────────────────────────────────
  if (err.code === 'VALIDATION_ERROR' && err.fields) {
    return res.status(422).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Validation failed', fields: err.fields }
    });
  }

  // ── SQLite | Postgres constraint violation ────────────────────────────────
  if (err.code === 'SQLITE_CONSTRAINT' || err.code === '23505') { // 23505 is PG unique violation
    return res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'Duplicate entry or constraint violation' }
    });
  }

  // ── JWT errors ────────────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: err.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token'
      }
    });
  }

  // ── Payload too large ─────────────────────────────────────────────────────
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds limit' }
    });
  }

  // ── Malformed JSON ────────────────────────────────────────────────────────
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Malformed JSON in request body' }
    });
  }

  // ── Generic fallback ──────────────────────────────────────────────────────
  return res.status(err.status || 500).json({
    success: false,
    error: {
      code: 'SERVER_ERROR',
      message: isDev ? err.message : 'An unexpected error occurred'
    }
  });
}

module.exports = errorHandler;
