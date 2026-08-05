const express = require('express');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const db = require('./db');
const log = require('./lib/logger');
const { requireAuth, requireAdmin, requireDeviceToken, loadUserWithGroups } = require('./auth');
const tokens = require('./lib/tokens');
const ispindel = require('./lib/ispindel');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_SESSION_SECRET = 'change-me-in-production';
const SESSION_SECRET = process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

if (process.env.NODE_ENV === 'production' && SESSION_SECRET === DEFAULT_SESSION_SECRET) {
  log.error('Refusing to start: set SESSION_SECRET in production');
  process.exit(1);
}

if (TRUST_PROXY) {
  app.set('trust proxy', 1);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP request logging
morgan.token('date', () => new Date().toISOString());
app.use(
  morgan('[ :date ] :method :url :status :response-time ms', {
    stream: { write: (msg) => log.info(msg.trim()) },
    skip: (req, res) =>
      process.env.NODE_ENV === 'test' ||
      (req.url === '/api/status' && res.statusCode === 200),
  })
);

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'gravity.sid',
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' && TRUST_PROXY,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  })
);

// Security headers (CSP mitigates XSS; scripts must be external files)
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'self'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrfToken;
}

function requireCsrf(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  // iSpindel posts token in JSON body with no session CSRF
  if (req.path === '/api/ispindel') return next();
  if (req.headers.authorization?.startsWith('Bearer ') || req.headers['x-api-key']) return next();
  const token = req.headers['x-csrf-token'];
  if (!token || token !== req.session?.csrfToken) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }
  next();
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts; try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests; try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const ispindelLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: 'Too many requests; try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// CSRF token for unauthenticated (e.g. login page)
app.get('/api/csrf-token', (req, res) => {
  const csrfToken = ensureCsrfToken(req);
  res.json({ csrfToken });
});

app.use(requireCsrf);

// Page routes (HTML only via sendFile; not via static)
app.get('/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/account', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'account.html'));
});

app.get('/tokens', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tokens.html'));
});

app.get('/ispindel', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ispindel.html'));
});

app.get('/status', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

// Auth API
app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const user = await db('users').where({ username }).first();
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    log.info('Login failed (invalid credentials)');
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (user.disabled) {
    log.info('Login failed (disabled user)', username);
    return res.status(403).json({ error: 'Account is disabled' });
  }
  req.session.regenerate(async (err) => {
    if (err) {
      log.error('Session regenerate failed', err.message);
      return res.status(500).json({ error: 'Login failed' });
    }
    req.session.userId = user.id;
    ensureCsrfToken(req);
    try {
      const withGroups = await loadUserWithGroups(user.id);
      log.info('Login ok', withGroups.username);
      return res.json({
        user: { id: withGroups.id, username: withGroups.username, groups: withGroups.groups },
        csrfToken: req.session.csrfToken,
      });
    } catch (e) {
      log.error('Login failed after regenerate', e.message);
      return res.status(500).json({ error: 'Login failed' });
    }
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ ok: true });
    }
    res.redirect('/login');
  });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const csrfToken = ensureCsrfToken(req);
  const user = req.user;
  res.json({
    user: user ? { id: user.id, username: user.username, groups: user.groups } : null,
    csrfToken,
  });
});

app.get('/api/account', requireAuth, async (req, res) => {
  const user = req.user;
  if (!user) return res.status(404).json({ error: 'User not found' });
  const csrfToken = ensureCsrfToken(req);
  res.json({
    csrfToken,
    user: {
      id: user.id,
      username: user.username,
      groups: user.groups,
      disabled: !!user.disabled,
    },
  });
});

app.post('/api/account/password', requireAuth, sensitiveLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const userRow = await db('users').where({ id: req.session.userId }).first();
  if (!userRow) return res.status(404).json({ error: 'User not found' });
  const ok = await bcrypt.compare(String(currentPassword), userRow.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const password_hash = await bcrypt.hash(String(newPassword), 12);
  await db('users').where({ id: userRow.id }).update({ password_hash });
  log.info('User changed password', userRow.username, 'id', userRow.id);
  return res.json({ ok: true });
});

// Users list
app.get('/api/admin/users', requireAuth, requireAdmin, async (_req, res) => {
  const rows = await db('users')
    .leftJoin('user_groups', 'users.id', 'user_groups.user_id')
    .leftJoin('groups', 'groups.id', 'user_groups.group_id')
    .select('users.id', 'users.username', 'users.disabled', 'groups.name as group_name')
    .orderBy('users.id', 'asc');

  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.id)) {
      byId.set(row.id, { id: row.id, username: row.username, disabled: !!row.disabled, groups: [] });
    }
    if (row.group_name && !byId.get(row.id).groups.includes(row.group_name)) {
      byId.get(row.id).groups.push(row.group_name);
    }
  }

  res.json({ users: Array.from(byId.values()) });
});

// Create user (optionally admin)
app.post('/api/admin/users', requireAuth, requireAdmin, sensitiveLimiter, async (req, res) => {
  const { username, password, isAdmin } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const name = String(username).trim();
  if (!name) return res.status(400).json({ error: 'Username is required' });
  if (name.length > 64) return res.status(400).json({ error: 'Username too long' });
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const existing = await db('users').where({ username: name }).first();
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    const password_hash = await bcrypt.hash(String(password), 12);
    const [userId] = await db('users').insert({ username: name, password_hash });

    if (isAdmin) {
      let adminGroup = await db('groups').where({ name: 'admin' }).first();
      if (!adminGroup) {
        const [gid] = await db('groups').insert({ name: 'admin' });
        adminGroup = { id: gid, name: 'admin' };
      }
      await db('user_groups').insert({ user_id: userId, group_id: adminGroup.id });
    }

    log.info('User created', name, 'id', userId);
    return res.status(201).json({ ok: true });
  } catch (e) {
    log.error('Failed to create user', e.message);
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

// Delete user
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const user = await db('users').where({ id }).first();
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (id === req.user?.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    // Prevent deleting the last admin user
    const admins = await db('user_groups')
      .join('groups', 'groups.id', 'user_groups.group_id')
      .where('groups.name', 'admin')
      .select('user_groups.user_id');
    const adminIds = new Set(admins.map((a) => a.user_id));
    if (adminIds.has(id) && adminIds.size === 1) {
      return res.status(400).json({ error: 'Cannot delete the last admin user' });
    }

    await db('users').where({ id }).delete();
    log.info('User deleted', user.username, 'id', id);
    return res.json({ ok: true });
  } catch (e) {
    log.error('Failed to delete user', e.message);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Update user groups and disabled flag
app.post('/api/admin/users/:id/groups', requireAuth, requireAdmin, sensitiveLimiter, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { groups, disabled } = req.body || {};
  try {
    const user = await db('users').where({ id }).first();
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent locking yourself out of admin
    const groupNames = Array.isArray(groups) ? groups.map((g) => String(g).trim()).filter((g) => g.length > 0) : [];
    if (groupNames.some((g) => g.length > 64)) {
      return res.status(400).json({ error: 'Group name too long' });
    }

    // If this update would remove admin from this user and they are the last admin, block it
    const admins = await db('user_groups')
      .join('groups', 'groups.id', 'user_groups.group_id')
      .where('groups.name', 'admin')
      .select('user_groups.user_id');
    const adminIds = new Set(admins.map((a) => a.user_id));
    const willBeAdmin = groupNames.includes('admin');
    if (!willBeAdmin && adminIds.has(id) && adminIds.size === 1) {
      return res.status(400).json({ error: 'Cannot remove admin role from the last admin user' });
    }

    // Upsert groups and user_groups
    const groupIds = [];
    for (const name of groupNames) {
      let g = await db('groups').where({ name }).first();
      if (!g) {
        const [gid] = await db('groups').insert({ name });
        g = { id: gid, name };
      }
      groupIds.push(g.id);
    }

    await db('user_groups').where({ user_id: id }).delete();
    for (const gid of groupIds) {
      await db('user_groups').insert({ user_id: id, group_id: gid });
    }

    // Update disabled flag (but don't allow disabling self if they are the last admin)
    let disabledFlag = !!disabled;
    if (id === req.user?.id && disabledFlag) {
      return res.status(400).json({ error: 'You cannot disable your own account' });
    }
    await db('users').where({ id }).update({ disabled: disabledFlag });

    log.info('User groups/disabled updated', user.username, 'id', id);
    return res.json({ ok: true });
  } catch (e) {
    log.error('Failed to update user groups', e.message);
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

// Groups list
app.get('/api/admin/groups', requireAuth, requireAdmin, async (_req, res) => {
  const groups = await db('groups').select('id', 'name').orderBy('name', 'asc');
  res.json({ groups });
});

// Create group
app.post('/api/admin/groups', requireAuth, requireAdmin, sensitiveLimiter, async (req, res) => {
  const name = req.body?.name?.trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length > 64) return res.status(400).json({ error: 'Group name too long' });
  try {
    await db('groups').insert({ name });
    const group = await db('groups').where({ name }).first();
    log.info('Group created', group.name, 'id', group.id);
    return res.status(201).json({ group });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Group already exists' });
    }
    log.error('Failed to create group', e.message);
    return res.status(500).json({ error: 'Failed to create group' });
  }
});

// Delete group (will also remove user mappings via FK if any)
app.delete('/api/admin/groups/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const existing = await db('groups').where({ id }).first();
    if (!existing) return res.status(404).json({ error: 'Group not found' });
    if (existing.name === 'admin') {
      return res.status(400).json({ error: 'Cannot delete admin group' });
    }
    await db('groups').where({ id }).delete();
    log.info('Group deleted', existing.name, 'id', id);
    return res.json({ ok: true });
  } catch (e) {
    log.error('Failed to delete group', e.message);
    return res.status(500).json({ error: 'Failed to delete group' });
  }
});

// API tokens: users manage own device tokens; admins may create admin tokens / list all
app.get('/api/tokens', requireAuth, async (req, res) => {
  const isAdmin = req.user.groups.includes('admin');
  const wantAll = req.query.all === '1' || req.query.all === 'true';
  if (wantAll && !isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const kind = req.query.kind ? String(req.query.kind) : null;
  if (kind && !tokens.KINDS.has(kind)) {
    return res.status(400).json({ error: 'Invalid kind' });
  }
  const list = await tokens.listTokens({
    userId: req.user.id,
    all: wantAll && isAdmin,
    kind,
  });
  res.json({ tokens: list });
});

app.post('/api/tokens', requireAuth, sensitiveLimiter, async (req, res) => {
  const name = req.body?.name?.trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length > 128) return res.status(400).json({ error: 'Token name too long' });

  const isAdmin = req.user.groups.includes('admin');
  let kind = tokens.normalizeKind(req.body?.kind);
  if (req.body?.kind != null && req.body.kind !== '' && !kind) {
    return res.status(400).json({ error: 'Invalid kind (use device or admin)' });
  }
  if (!kind) kind = 'device';
  if (kind === 'admin' && !isAdmin) {
    return res.status(403).json({ error: 'Only admins can create admin tokens' });
  }

  try {
    const created = await tokens.createToken(name, req.user.id, kind);
    log.info('API token created', created.kind, created.name, 'id', created.id, 'user', req.user.username);
    return res.status(201).json(created);
  } catch (e) {
    log.error('Failed to create API token', e.message);
    return res.status(500).json({ error: 'Failed to create token' });
  }
});

app.delete('/api/tokens/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const existing = await tokens.getTokenById(id);
  if (!existing) return res.status(404).json({ error: 'Token not found' });
  const isAdmin = req.user.groups.includes('admin');
  if (!isAdmin && existing.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const n = await tokens.revokeToken(id);
  if (n === 0) return res.status(404).json({ error: 'Token not found' });
  log.info('API token revoked', id, 'by', req.user.username);
  return res.json({ ok: true });
});

// iSpindel ingest (device token; CSRF skipped for this path)
app.post('/api/ispindel', ispindelLimiter, requireDeviceToken, async (req, res) => {
  const parsed = ispindel.parseReading(req.body || {});
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }
  try {
    const id = await ispindel.insertReading(req.apiToken.id, parsed.reading);
    log.info('iSpindel reading', 'token', req.apiToken.id, 'reading', id);
    return res.json({ ok: true, id });
  } catch (e) {
    log.error('Failed to store iSpindel reading', e.message);
    return res.status(500).json({ error: 'Failed to store reading' });
  }
});

app.get('/api/ispindel/devices', requireAuth, async (req, res) => {
  const devices = await ispindel.listDevicesWithLatest({
    userId: req.user.id,
    isAdmin: req.user.groups.includes('admin'),
  });
  res.json({ devices });
});

app.get('/api/ispindel/readings', requireAuth, async (req, res) => {
  const tokenId = parseInt(req.query.token_id, 10);
  if (Number.isNaN(tokenId)) {
    return res.status(400).json({ error: 'token_id is required' });
  }
  let limit = parseInt(req.query.limit, 10);
  if (Number.isNaN(limit) || limit < 1) limit = 100;
  if (limit > 500) limit = 500;

  const token = await ispindel.canAccessDeviceToken(tokenId, {
    userId: req.user.id,
    isAdmin: req.user.groups.includes('admin'),
  });
  if (!token) return res.status(404).json({ error: 'Device not found' });

  const readings = await ispindel.listReadings(tokenId, limit);
  res.json({ readings });
});

// Health/status for monitoring (protected; requires auth)
app.get('/api/status', requireAuth, async (_req, res) => {
  let dbOk = false;
  try {
    await db.raw('select 1');
    dbOk = true;
  } catch (_e) {
    // leave dbOk false
  }
  res.json({
    ok: true,
    uptime: process.uptime(),
    time: new Date().toISOString(),
    database: dbOk ? 'connected' : 'disconnected',
  });
});

// Assets only: never serve HTML via static (pages use guarded sendFile routes)
app.use((req, res, next) => {
  if (/\.html?$/i.test(req.path)) {
    return res.status(404).send('Not found');
  }
  next();
});
app.use(
  express.static(path.join(__dirname, 'public'), {
    index: false,
  })
);

async function start() {
  await db.ensureMigrations();
  app.listen(PORT, HOST, () => {
    log.info('gravity listening', `http://${HOST}:${PORT}`);
  });
}

module.exports = app;

if (require.main === module) {
  start().catch((err) => {
    log.error(err);
    process.exit(1);
  });
}
