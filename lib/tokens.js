const crypto = require('crypto');
const db = require('../db');

const TOKEN_BYTES = 24;
const PREFIX_LEN = 8;
const KINDS = new Set(['device', 'admin']);

function hashToken(plain) {
  return crypto.createHash('sha256').update(plain, 'utf8').digest('hex');
}

function generateSecret() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function normalizeKind(kind) {
  if (kind == null || kind === '') return 'device';
  const k = String(kind).trim().toLowerCase();
  if (!KINDS.has(k)) return null;
  return k;
}

/**
 * Create a new API token. Returns { id, name, kind, token, prefix, created_at }.
 * The plain `token` is only returned once; store it securely.
 */
async function createToken(name, userId, kind = 'device') {
  const normalized = normalizeKind(kind);
  if (!normalized) {
    throw new Error('Invalid token kind');
  }
  const token = generateSecret();
  const token_hash = hashToken(token);
  const token_prefix = token.slice(0, PREFIX_LEN);
  await db('api_tokens').insert({
    name,
    token_hash,
    token_prefix,
    user_id: userId,
    kind: normalized,
  });
  const created = await db('api_tokens').where({ token_hash }).first();
  return {
    id: created.id,
    name: created.name,
    kind: created.kind,
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
 * List tokens (without secrets).
 * @param {{ userId?: number|null, all?: boolean, kind?: string|null }} opts
 */
async function listTokens(opts = {}) {
  const { userId = null, all = false, kind = null } = opts;
  const q = db('api_tokens')
    .select(
      'api_tokens.id',
      'api_tokens.name',
      'api_tokens.kind',
      'api_tokens.token_prefix',
      'api_tokens.user_id',
      'api_tokens.created_at',
      'api_tokens.last_used_at',
      'users.username as owner_username'
    )
    .leftJoin('users', 'users.id', 'api_tokens.user_id')
    .orderBy('api_tokens.created_at', 'desc');
  if (!all && userId != null) q.where({ 'api_tokens.user_id': userId });
  if (kind) q.where({ 'api_tokens.kind': kind });
  return q;
}

async function getTokenById(id) {
  return db('api_tokens').where({ id }).first();
}

async function revokeToken(id, userId = null) {
  const q = db('api_tokens').where({ id }).delete();
  if (userId != null) q.andWhere({ user_id: userId });
  return q;
}

module.exports = {
  KINDS,
  hashToken,
  createToken,
  validateToken,
  listTokens,
  getTokenById,
  revokeToken,
  normalizeKind,
};
