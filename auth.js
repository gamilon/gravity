const db = require('./db');
const { validateToken } = require('./lib/tokens');

async function loadUserWithGroups(userId) {
  if (!userId) return null;
  const user = await db('users').where({ id: userId }).first();
  if (!user) return null;
  const groups = await db('user_groups')
    .join('groups', 'groups.id', 'user_groups.group_id')
    .where('user_groups.user_id', userId)
    .select('groups.name');
  return {
    id: user.id,
    username: user.username,
    disabled: !!user.disabled,
    groups: groups.map((g) => g.name),
  };
}

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/login');
  }
  next();
}

async function requireAdmin(req, res, next) {
  if (!req.session?.userId) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/login');
  }
  const user = await loadUserWithGroups(req.session.userId);
  if (!user || !user.groups.includes('admin')) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return res.status(403).send('Forbidden');
  }
  req.user = user;
  next();
}

/**
 * Authenticate via API token (Bearer or X-API-Key header only). Sets req.apiToken and req.user (token owner).
 * Use for device/client access; does not require session. Do not pass tokens in URLs (they can leak in Referer/logs).
 */
async function requireApiToken(req, res, next) {
  const raw =
    req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : req.headers['x-api-key']?.trim();
  if (!raw) {
    return res.status(401).json({ error: 'API token required (Authorization: Bearer <token> or X-API-Key: <token>)' });
  }
  const row = await validateToken(raw);
  if (!row) {
    return res.status(401).json({ error: 'Invalid API token' });
  }
  req.apiToken = row;
  const user = await loadUserWithGroups(row.user_id);
  req.user = user;
  next();
}

module.exports = {
  loadUserWithGroups,
  requireAuth,
  requireAdmin,
  requireApiToken,
};
