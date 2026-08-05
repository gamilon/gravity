'use strict';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-test-secret';

const fs = require('fs');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const request = require('supertest');

const dbPath = path.join(__dirname, '..', 'data', 'gravity-test.sqlite3');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.unlinkSync(dbPath + suffix);
  } catch {
    // ignore missing files
  }
}

const db = require('../db');
const app = require('../server');

const ADMIN_USER = 'ci-admin';
const ADMIN_PASS = 'ci-admin-pass-123';
const VIEWER_USER = 'ci-viewer';
const VIEWER_PASS = 'ci-viewer-pass-123';
const DISABLE_USER = 'ci-disable-me';
const DISABLE_PASS = 'ci-disable-pass-123';

function cookieValue(res, name) {
  const raw = res.headers['set-cookie'];
  if (!raw) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  const match = list.find((c) => c.startsWith(`${name}=`));
  if (!match) return null;
  return match.split(';')[0].slice(name.length + 1);
}

async function login(agent, username, password) {
  const csrfRes = await agent.get('/api/csrf-token').expect(200);
  const csrfToken = csrfRes.body.csrfToken;
  assert.ok(csrfToken);
  const loginRes = await agent
    .post('/api/login')
    .set('X-CSRF-Token', csrfToken)
    .send({ username, password });
  return { csrfRes, loginRes, csrfToken };
}

describe('gravity smoke', () => {
  before(async () => {
    await db.ensureMigrations();

    await db('user_groups').del();
    await db('api_tokens').del().catch(() => {});
    await db('users').del();
    await db('groups').del();

    const [adminGroupId] = await db('groups').insert({ name: 'admin' });
    const adminHash = await bcrypt.hash(ADMIN_PASS, 4);
    const viewerHash = await bcrypt.hash(VIEWER_PASS, 4);
    const disableHash = await bcrypt.hash(DISABLE_PASS, 4);

    const [adminId] = await db('users').insert({
      username: ADMIN_USER,
      password_hash: adminHash,
      disabled: false,
    });
    const [viewerId] = await db('users').insert({
      username: VIEWER_USER,
      password_hash: viewerHash,
      disabled: false,
    });
    await db('users').insert({
      username: DISABLE_USER,
      password_hash: disableHash,
      disabled: false,
    });

    await db('user_groups').insert({ user_id: adminId, group_id: adminGroupId });
    // viewer has no groups
    void viewerId;
  });

  after(async () => {
    await db.destroy();
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        // ignore
      }
    }
  });

  it('redirects unauthenticated / to /login', async () => {
    const res = await request(app).get('/').expect(302);
    assert.match(res.headers.location, /\/login$/);
  });

  it('does not serve HTML shells via static', async () => {
    await request(app).get('/admin.html').expect(404);
    await request(app).get('/index.html').expect(404);
  });

  it('serves JS and CSS assets', async () => {
    await request(app).get('/js/common.js').expect(200);
    await request(app).get('/styles.css').expect(200);
  });

  it('sets CSP without unsafe-inline scripts', async () => {
    const res = await request(app).get('/login').expect(200);
    const csp = res.headers['content-security-policy'];
    assert.ok(csp);
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  });

  it('logs in, regenerates session, and returns /api/me', async () => {
    const agent = request.agent(app);
    const csrfRes = await agent.get('/api/csrf-token').expect(200);
    const preLoginSid = cookieValue(csrfRes, 'gravity.sid');
    assert.ok(preLoginSid);

    const loginRes = await agent
      .post('/api/login')
      .set('X-CSRF-Token', csrfRes.body.csrfToken)
      .send({ username: ADMIN_USER, password: ADMIN_PASS })
      .expect(200);

    assert.equal(loginRes.body.user.username, ADMIN_USER);
    const postLoginSid = cookieValue(loginRes, 'gravity.sid');
    assert.ok(postLoginSid);
    assert.notEqual(postLoginSid, preLoginSid);

    const me = await agent.get('/api/me').expect(200);
    assert.equal(me.body.user.username, ADMIN_USER);
    assert.ok(me.body.user.groups.includes('admin'));
  });

  it('rejects disabled users on authenticated requests', async () => {
    const agent = request.agent(app);
    const { loginRes } = await login(agent, DISABLE_USER, DISABLE_PASS);
    assert.equal(loginRes.status, 200);

    await db('users').where({ username: DISABLE_USER }).update({ disabled: true });

    await agent.get('/api/me').expect(401);
  });

  it('forbids non-admin from admin pages and tokens API', async () => {
    const agent = request.agent(app);
    const { loginRes } = await login(agent, VIEWER_USER, VIEWER_PASS);
    assert.equal(loginRes.status, 200);

    await agent.get('/admin').expect(403);
    await agent.get('/api/tokens').expect(403);
  });
});
