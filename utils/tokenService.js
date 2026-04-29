const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db/connection');

const ACCESS_EXPIRES_IN = '24h';
const REFRESH_EXPIRES_DAYS = 7;
const REFRESH_EXPIRES_MS = REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000;

class TokenService {
  /**
   * Generates a secure random opaque token for refresh
   * (JWT is suitable too, but random strings are often used for refresh tokens)
   */
  static generateRefreshTokenString() {
    return crypto.randomBytes(40).toString('hex');
  }

  /**
   * Generates JWT paired with a hashed refresh token mapped to the DB
   */
  static async issueTokens(user) {
    const payload = { 
      id: user.id, 
      username: user.username, 
      email: user.email, 
      role: user.role || 'user' 
    };

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
    const refreshToken = this.generateRefreshTokenString();
    
    // Hash before saving
    const hashedToken = bcrypt.hashSync(refreshToken, 10);
    const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_MS).toISOString();
    const createdAt = new Date().toISOString();

    await db.prepare(
      'INSERT INTO refresh_tokens (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)'
    ).run(user.id, hashedToken, expiresAt, createdAt);

    return { accessToken, refreshToken };
  }

  /**
   * Validates a raw refresh token and returns the matched DB record if valid
   */
  static async validateRefreshToken(rawToken) {
    // Find all unexpired tokens (performance optimization: we would normally index the exact token but we hashed it securely)
    // To find the exact token we need the user_id or we must check the hashes. 
    // BUT since we just get the "rawToken", we should really pass the user_id alongside the rawToken, OR decode user_id if it's a JWT.
    // Instead, let's encode the user_id into the refresh token string base64: `${userId}.${randomString}`.
    return null; // Implemented below via encoding
  }

  static generateRefreshTokenStringWithUserId(userId) {
    const random = crypto.randomBytes(40).toString('hex');
    const b64Id = Buffer.from(userId.toString()).toString('base64');
    return `${b64Id}.${random}`;
  }

  static async issueEnhancedTokens(user) {
    const payload = { 
      id: user.id, 
      username: user.username, 
      email: user.email, 
      role: user.role || 'user' 
    };

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
    const refreshToken = this.generateRefreshTokenStringWithUserId(user.id);
    
    const hashedToken = bcrypt.hashSync(refreshToken, 10);
    const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_MS).toISOString();
    const createdAt = new Date().toISOString();

    await db.prepare(
      'INSERT INTO refresh_tokens (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)'
    ).run(user.id, hashedToken, expiresAt, createdAt);

    return { accessToken, refreshToken };
  }

  static async rotateRefreshToken(oldRawToken) {
    if (!oldRawToken.includes('.')) {
      throw new Error('Invalid token structure');
    }
    const [b64Id, ] = oldRawToken.split('.');
    const userId = Buffer.from(b64Id, 'base64').toString('utf8');

    if (!userId || isNaN(userId)) {
      throw new Error('Invalid token identity');
    }

    // Find token among user's active tokens
    const now = new Date().toISOString();
    const tokens = await db.prepare('SELECT * FROM refresh_tokens WHERE user_id = ? AND expires_at > ?').all(userId, now);

    let matchingTokenRecord = null;
    for (const record of tokens) {
      if (bcrypt.compareSync(oldRawToken, record.token)) {
        matchingTokenRecord = record;
        break;
      }
    }

    if (!matchingTokenRecord) {
      throw new Error('Token compromised or expired');
    }

    // Invalidate old token (Rotation)
    await db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(matchingTokenRecord.id);

    // Fetch user to issue new tokens
    const user = await db.prepare('SELECT id, username, email, role FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');

    return this.issueEnhancedTokens(user);
  }

  static async revokeToken(rawToken) {
    if (!rawToken || !rawToken.includes('.')) return;
    const [b64Id, ] = rawToken.split('.');
    const userId = Buffer.from(b64Id, 'base64').toString('utf8');
    
    const tokens = await db.prepare('SELECT * FROM refresh_tokens WHERE user_id = ?').all(userId);
    for (const record of tokens) {
      if (bcrypt.compareSync(rawToken, record.token)) {
        await db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(record.id);
        break;
      }
    }
  }

  static async revokeAllUserTokens(userId) {
    await db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId);
  }
}

module.exports = TokenService;
