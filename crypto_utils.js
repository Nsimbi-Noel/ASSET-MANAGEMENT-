const crypto = require('crypto');
const { promisify } = require('util');

const pbkdf2 = promisify(crypto.pbkdf2);
const PASSWORD_ITERATIONS = 600000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

/**
 * Hash a password using PBKDF2 (asynchronously, so it does not block the
 * event loop under concurrent login/registration load).
 * @param {string} password - The plain-text password.
 * @returns {Promise<string>} - The formatted hash `salt:hash`.
 */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await pbkdf2(password, salt, PASSWORD_ITERATIONS, KEY_LENGTH, DIGEST);
  return `${salt}:${hash.toString('hex')}`;
}

/**
 * Verify a password against a stored PBKDF2 hash (asynchronously).
 * @param {string} password - The plain-text password to check.
 * @param {string} storedHash - The stored hash in `salt:hash` format.
 * @returns {Promise<boolean>} - True if password matches, false otherwise.
 */
async function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, originalHash] = storedHash.split(':');
  const hash = await pbkdf2(password, salt, PASSWORD_ITERATIONS, KEY_LENGTH, DIGEST);
  return hash.toString('hex') === originalHash;
}

module.exports = {
  hashPassword,
  verifyPassword
};
