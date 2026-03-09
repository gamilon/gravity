const crypto = require('crypto');
const db = require('../db');

const TOKEN_BYTES = 24;
const PREFIX_LEN = 8;

function hashToken(plain) {
  return crypto.createHash('sha256').update(plain, 'utf8').digest('hex');
}

function generateSecret() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Create a new API token. Returns { id, name, token, prefix, created_at }.
 * The plain `token` is only returned once; store it securely.
 */
async function createToken(name, userId) {
  const token = generateSecret();
  const token_hash = hashToken(token);
  const token_prefix = token.slice(0, PREFIX_LEN);
  await db('api_tokens').insert({ name, token_hash, token_prefix, user_id: userId });
  const created = await db('api_tokens').where({ token_hash }).first();
  return {
    id: created.id,
    name: created.name,
    token,
    prefix: created.token_prefix,
    created_at: created.created_at,
  };
}

/**
 * Validate a plain token. Returns the token row or null.
 * Optionally updates last_used_at.
 */
async function validateToken(plainToken, updateLastUsed = true) {
  if (!plainToken || typeof plainToken !== 'string') return null;
  const token_hash = hashToken(plainToken.trim());
  const row = await db('api_tokens').where({ token_hash }).first();
  if (!row) return null;
  if (updateLastUsed) {
    await db('api_tokens').where({ id: row.id }).update({ last_used_at: new Date() });
  }
  return row;
}

/**
 * List tokens (without secrets). Optional filter by user_id.
 */
async function listTokens(userId = null) {
  const q = db('api_tokens').select('id', 'name', 'token_prefix', 'user_id', 'created_at', 'last_used_at').orderBy('created_at', 'desc');
  if (userId != null) q.where({ user_id: userId });
  return q;
}

async function revokeToken(id, userId = null) {
  const q = db('api_tokens').where({ id }).delete();
  if (userId != null) q.andWhere({ user_id: userId });
  return q;
}

module.exports = {
  hashToken,
  createToken,
  validateToken,
  listTokens,
  revokeToken,
};
