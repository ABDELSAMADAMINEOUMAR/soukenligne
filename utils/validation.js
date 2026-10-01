/**
 * Input validation utilities.
 * Provides server-side length, type, and format validation
 * for user-controlled inputs across the application.
 */

// Maximum field lengths (in characters)
const MAX_LENGTHS = {
  full_name: 200,
  email: 254,        // RFC 5321 maximum
  phone: 30,
  whatsapp: 30,
  password: 72,      // bcrypt truncates at 72 bytes
  delivery_full_name: 200,
  delivery_phone: 30,
  delivery_city: 100,
  delivery_neighborhood: 200,
  delivery_address: 500,
  delivery_landmark: 300,
  delivery_notes: 1000,
  product_name: 300,
  product_description: 10000,
  product_short_description: 1000,
  brand: 200,
  sku: 100,
  meta_title: 200,
  meta_description: 500,
  category_name: 200,
  category_description: 1000,
  zone_name: 200,
  admin_notes: 2000,
  setting_value: 2000,
  search_query: 200,
};

/**
 * Validates that specified fields in the request body
 * do not exceed their maximum allowed lengths.
 * 
 * @param {Object} body - req.body
 * @param {Object} fieldMap - { bodyFieldName: maxLengthKey }
 * @returns {string|null} - Error message or null if valid
 */
function validateLengths(body, fieldMap) {
  for (const [bodyField, maxKey] of Object.entries(fieldMap)) {
    const value = body[bodyField];
    if (value && typeof value === 'string') {
      const max = MAX_LENGTHS[maxKey] || MAX_LENGTHS[bodyField];
      if (max && value.length > max) {
        return `Le champ est trop long (maximum ${max} caractères).`;
      }
    }
  }
  return null;
}

/**
 * Validates password meets minimum and maximum length requirements.
 * bcrypt truncates at 72 bytes, so we enforce a 72-character maximum.
 * 
 * @param {string} password
 * @returns {string|null} - Error message or null if valid
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return 'Le mot de passe est requis.';
  }
  if (password.length < 12) {
    return 'Le mot de passe doit contenir au moins 12 caractères.';
  }
  if (password.length > 72) {
    return 'Le mot de passe ne peut pas dépasser 72 caractères.';
  }
  return null;
}

/**
 * Invalidates all other sessions for a given user ID.
 * The current session (identified by currentSid) is preserved.
 * 
 * This ensures that after a password change or reset,
 * any attacker who compromised an old session is immediately logged out.
 * 
 * @param {Object} db - PostgreSQL pool/client
 * @param {number|string} userId - The user's ID
 * @param {string|null} currentSid - The session ID to preserve (null = purge all)
 */
async function invalidateOtherSessions(db, userId, currentSid) {
  try {
    if (currentSid) {
      // Delete all sessions for this user EXCEPT the current one
      await db.query(
        "DELETE FROM session WHERE sess::text LIKE $1 AND sid != $2",
        [`%"userId":${parseInt(userId)}%`, currentSid]
      );
    } else {
      // Delete ALL sessions for this user (e.g., password reset from unauthenticated context)
      await db.query(
        "DELETE FROM session WHERE sess::text LIKE $1",
        [`%"userId":${parseInt(userId)}%`]
      );
    }
  } catch (err) {
    // Fail safely — don't crash the request if session cleanup fails
    console.error('Session invalidation error:', err);
  }
}

module.exports = {
  MAX_LENGTHS,
  validateLengths,
  validatePassword,
  invalidateOtherSessions,
};
