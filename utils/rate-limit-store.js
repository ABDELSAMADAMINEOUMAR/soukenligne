const { getDb } = require('../db/init');

class PostgresStore {
  constructor(options = {}) {
    this.prefix = options.prefix || 'rl:';
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const db = getDb();
    const prefixedKey = this.prefix + key;
    const now = Date.now();
    
    try {
      // Clean up expired records occasionally (or rely on upsert logic)
      // Here we just use an upsert to increment hits or reset if expired.
      const query = `
        INSERT INTO rate_limits (key, hits, expires_at)
        VALUES ($1, 1, $2)
        ON CONFLICT (key) DO UPDATE
        SET 
          hits = CASE WHEN rate_limits.expires_at <= $3 THEN 1 ELSE rate_limits.hits + 1 END,
          expires_at = CASE WHEN rate_limits.expires_at <= $3 THEN $2 ELSE rate_limits.expires_at END
        RETURNING hits, expires_at
      `;
      const result = await db.query(query, [prefixedKey, now + this.windowMs, now]);
      const row = result.rows[0];
      
      return {
        totalHits: row.hits,
        resetTime: new Date(Number(row.expires_at))
      };
    } catch (err) {
      console.error('Rate limit PostgresStore error:', err);
      // Fallback safe mode: allow request if DB fails
      return {
        totalHits: 0,
        resetTime: new Date(now + this.windowMs)
      };
    }
  }

  async decrement(key) {
    const db = getDb();
    const prefixedKey = this.prefix + key;
    try {
      await db.query(`UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = $1`, [prefixedKey]);
    } catch (err) {
      console.error('Rate limit PostgresStore error:', err);
    }
  }

  async resetKey(key) {
    const db = getDb();
    const prefixedKey = this.prefix + key;
    try {
      await db.query(`DELETE FROM rate_limits WHERE key = $1`, [prefixedKey]);
    } catch (err) {
      console.error('Rate limit PostgresStore error:', err);
    }
  }
}

module.exports = PostgresStore;
