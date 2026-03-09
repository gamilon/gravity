const express = require('express');
const path = require('path');
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
    },
  })
);

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
  res.json({ user: user ? { id: user.id, username: user.username, groups: user.groups } : null });
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
