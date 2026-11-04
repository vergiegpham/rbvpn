import crypto from 'crypto';
import bcrypt from 'bcryptjs';

// bcrypt only uses the first 72 bytes of a password.
export const PASSWORD_MAX = 72;
export const PASSWORD_MIN = 8;

export function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/** Readable random password (no look-alike characters) for admin resets and first admin seed. */
export function generatePassword(length = 14) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}
