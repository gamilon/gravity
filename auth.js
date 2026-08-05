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

function wantsJson(req) {
  return (
    req.path.startsWith('/api/') ||
    req.xhr ||
    (req.headers.accept || '').includes('application/json')
  );
}

function unauthorized(req, res) {
  if (wantsJson(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/login');
}

function forbidden(req, res) {
  if (wantsJson(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return res.status(403).send('Forbidden');
}

function destroySession(req) {
  return new Promise((resolve) => {
    if (!req.session) return resolve();
    req.session.destroy(() => resolve());
  });
}

async function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return unauthorized(req, res);
  }
  try {
    const user = await loadUserWithGroups(req.session.userId);
    if (!user || user.disabled) {
      await destroySession(req);
      return unauthorized(req, res);
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

async function requireAdmin(req, res, next) {
  if (!req.user) {
    return requireAuth(req, res, () => requireAdmin(req, res, next));
  }
  if (!req.user.groups.includes('admin')) {
    return forbidden(req, res);
  }
  next();
}

function extractRawToken(req) {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return req.headers.authorization.slice(7).trim();
  }
  if (req.headers['x-api-key']) {
    return String(req.headers['x-api-key']).trim();
  }
  if (req.body?.token != null && String(req.body.token).trim()) {
    return String(req.body.token).trim();
  }
  return null;
}

/**
 * Authenticate via API token (Bearer, X-API-Key, or JSON body token).
 * Sets req.apiToken and req.user (token owner). Do not pass tokens in URLs.
 */
async function requireApiToken(req, res, next) {
  const raw = extractRawToken(req);
  if (!raw) {
    return res.status(401).json({
      error: 'API token required (Authorization: Bearer <token>, X-API-Key, or JSON body token)',
    });
  }
  const row = await validateToken(raw);
  if (!row) {
    return res.status(401).json({ error: 'Invalid API token' });
  }
  const user = await loadUserWithGroups(row.user_id);
  if (!user || user.disabled) {
    return res.status(401).json({ error: 'Invalid API token' });
  }
  req.apiToken = row;
  req.user = user;
  next();
}

/**
 * Like requireApiToken but only accepts kind=device (iSpindel ingest).
 */
async function requireDeviceToken(req, res, next) {
  return requireApiToken(req, res, () => {
    if (req.apiToken.kind !== 'device') {
      return res.status(401).json({ error: 'Device token required' });
    }
    next();
  });
}

module.exports = {
  loadUserWithGroups,
  requireAuth,
  requireAdmin,
  requireApiToken,
  requireDeviceToken,
};
