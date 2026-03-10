const express = require('express');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const db = require('./db');
const log = require('./lib/logger');
const { requireAuth, requireAdmin, loadUserWithGroups } = require('./auth');
const tokens = require('./lib/tokens');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP request logging
morgan.token('date', () => new Date().toISOString());
app.use(
  morgan('[ :date ] :method :url :status :response-time ms', {
    stream: { write: (msg) => log.info(msg.trim()) },
    skip: (req, res) => req.url === '/api/status' && res.statusCode === 200,
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
      secure: process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY === '1',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  })
);

// Security headers (CSP helps mitigate XSS impact)
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'self'"
  );
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
  if (req.headers.authorization?.startsWith('Bearer ') || req.headers['x-api-key']) return next();
  const token = req.headers['x-csrf-token'];
  if (!token || token !== req.session?.csrfToken) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }
  next();
}

// CSRF token for unauthenticated (e.g. login page)
app.get('/api/csrf-token', (req, res) => {
  const csrfToken = ensureCsrfToken(req);
  res.json({ csrfToken });
});

app.use(requireCsrf);

// Login page (before static)
app.get('/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Auth API
app.post('/api/login', async (req, res) => {
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
  req.session.userId = user.id;
  const withGroups = await loadUserWithGroups(user.id);
  log.info('Login ok', withGroups.username);
  return res.json({ user: { id: withGroups.id, username: withGroups.username, groups: withGroups.groups } });
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
  const user = await loadUserWithGroups(req.session.userId);
  const csrfToken = ensureCsrfToken(req);
  res.json({
    user: user ? { id: user.id, username: user.username, groups: user.groups } : null,
    csrfToken,
  });
});

// Admin overview (users, groups) – admin only
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// My account
app.get('/account', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'account.html'));
});
app.get('/api/account', requireAuth, async (req, res) => {
  const user = await loadUserWithGroups(req.session.userId);
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
app.post('/api/account/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
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
    .select('users.id', 'users.username', 'groups.name as group_name')
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
app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, isAdmin } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const name = String(username).trim();
  if (!name) return res.status(400).json({ error: 'Username is required' });
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
app.post('/api/admin/users/:id/groups', requireAuth, requireAdmin, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { groups, disabled } = req.body || {};
  try {
    const user = await db('users').where({ id }).first();
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent locking yourself out of admin
    const groupNames = Array.isArray(groups) ? groups.map((g) => String(g).trim()).filter((g) => g.length > 0) : [];

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
app.post('/api/admin/groups', requireAuth, requireAdmin, async (req, res) => {
  const name = req.body?.name?.trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
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

// API tokens (admin only)
app.get('/tokens', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tokens.html'));
});
app.get('/api/tokens', requireAuth, requireAdmin, async (req, res) => {
  const list = await tokens.listTokens();
  res.json({ tokens: list });
});
app.post('/api/tokens', requireAuth, requireAdmin, async (req, res) => {
  const name = req.body?.name?.trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const created = await tokens.createToken(name, req.session.userId);
    log.info('API token created', created.name, 'id', created.id);
    return res.status(201).json(created);
  } catch (e) {
    log.error('Failed to create API token', e.message);
    return res.status(500).json({ error: 'Failed to create token' });
  }
});
app.delete('/api/tokens/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const n = await tokens.revokeToken(id);
  if (n === 0) return res.status(404).json({ error: 'Token not found' });
  log.info('API token revoked', id);
  return res.json({ ok: true });
});

// Status page (protected)
app.get('/status', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// Health/status for monitoring (protected; requires auth)
app.get('/api/status', requireAuth, async (req, res) => {
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

// Home: redirect to login if not authenticated
app.get('/', (req, res) => {
  if (!req.session?.userId) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await db.ensureMigrations();
  app.listen(PORT, HOST, () => {
    log.info('gravity listening', `http://${HOST}:${PORT}`);
  });
}

start().catch((err) => {
  log.error(err);
  process.exit(1);
});
