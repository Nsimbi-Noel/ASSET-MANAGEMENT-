const crypto = require('crypto');

/**
 * Hash a password using PBKDF2.
 * @param {string} password - The plain-text password.
 * @returns {string} - The formatted hash `salt:hash`.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify a password against a stored PBKDF2 hash.
 * @param {string} password - The plain-text password to check.
 * @param {string} storedHash - The stored hash in `salt:hash` format.
 * @returns {boolean} - True if password matches, false otherwise.
 */
function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, originalHash] = storedHash.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === originalHash;
}

module.exports = {
  hashPassword,
  verifyPassword
};
