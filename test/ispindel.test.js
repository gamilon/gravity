'use strict';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-test-secret';

const fs = require('fs');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const request = require('supertest');

const dbPath = path.join(__dirname, '..', 'data', 'gravity-test-ispindel.sqlite3');
process.env.GRAVITY_TEST_DB = dbPath;
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
const tokensLib = require('../lib/tokens');

const USER_A = 'ispindel-a';
const USER_B = 'ispindel-b';
const PASS = 'ispindel-pass-123';
const ADMIN = 'ispindel-admin';

async function login(agent, username, password) {
  const csrfRes = await agent.get('/api/csrf-token').expect(200);
  const loginRes = await agent
    .post('/api/login')
    .set('X-CSRF-Token', csrfRes.body.csrfToken)
    .send({ username, password })
    .expect(200);
  // Session regenerate rotates CSRF; use the post-login token
  const csrf = loginRes.body.csrfToken || csrfRes.body.csrfToken;
  return { csrf, loginRes };
}

async function createDeviceToken(agent, csrf, name) {
  const res = await agent
    .post('/api/tokens')
    .set('X-CSRF-Token', csrf)
    .send({ name, kind: 'device' })
    .expect(201);
  return res.body;
}

describe('iSpindel devices', () => {
  let userAId;
  let userBId;
  let adminId;

  before(async () => {
    await db.ensureMigrations();
    await db('ispindel_readings').del().catch(() => {});
    await db('api_tokens').del().catch(() => {});
    await db('user_groups').del();
    await db('users').del();
    await db('groups').del();

    let adminGroup = await db('groups').where({ name: 'admin' }).first();
    if (!adminGroup) {
      const [gid] = await db('groups').insert({ name: 'admin' });
      adminGroup = { id: gid };
    }

    const hash = await bcrypt.hash(PASS, 4);
    [userAId] = await db('users').insert({ username: USER_A, password_hash: hash, disabled: false });
    [userBId] = await db('users').insert({ username: USER_B, password_hash: hash, disabled: false });
    [adminId] = await db('users').insert({ username: ADMIN, password_hash: hash, disabled: false });
    await db('user_groups').insert({ user_id: adminId, group_id: adminGroup.id });
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

  it('rejects non-admin creating admin tokens', async () => {
    const agent = request.agent(app);
    const { csrf } = await login(agent, USER_A, PASS);
    const res = await agent
      .post('/api/tokens')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'nope', kind: 'admin' })
      .expect(403);
    assert.match(res.body.error, /admin/i);
  });

  it('separates readings by device token', async () => {
    const agent = request.agent(app);
    const { csrf } = await login(agent, USER_A, PASS);
    const t1 = await createDeviceToken(agent, csrf, 'Device One');
    const t2 = await createDeviceToken(agent, csrf, 'Device Two');
    assert.ok(t1.token);
    assert.ok(t2.token);
    assert.equal(t1.kind, 'device');

    await request(app)
      .post('/api/ispindel')
      .send({
        name: 'same-name',
        token: t1.token,
        temperature: 20.1,
        gravity: 1.05,
        angle: 25,
        battery: 3.9,
      })
      .expect(200);

    await request(app)
      .post('/api/ispindel')
      .send({
        name: 'same-name',
        token: t2.token,
        temperature: 18.2,
        gravity: 1.01,
        angle: 40,
        battery: 3.7,
      })
      .expect(200);

    const devices = await agent.get('/api/ispindel/devices').expect(200);
    assert.equal(devices.body.devices.length, 2);
    const byName = Object.fromEntries(devices.body.devices.map((d) => [d.name, d]));
    assert.equal(byName['Device One'].latest.temperature, 20.1);
    assert.equal(byName['Device Two'].latest.temperature, 18.2);
    assert.equal(byName['Device One'].latest.device_name, 'same-name');
  });

  it('rejects admin tokens and bad tokens on ingest', async () => {
    const agent = request.agent(app);
    const { csrf } = await login(agent, ADMIN, PASS);
    const adminTok = await agent
      .post('/api/tokens')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'admin-key', kind: 'admin' })
      .expect(201);

    await request(app)
      .post('/api/ispindel')
      .send({ token: adminTok.body.token, temperature: 21 })
      .expect(401);

    await request(app)
      .post('/api/ispindel')
      .send({ token: 'not-a-real-token', temperature: 21 })
      .expect(401);
  });

  it('hides other users device tokens from non-admins', async () => {
    const agentA = request.agent(app);
    const { csrf: csrfA } = await login(agentA, USER_A, PASS);
    const owned = await createDeviceToken(agentA, csrfA, 'A-only');

    await request(app)
      .post('/api/ispindel')
      .send({ token: owned.token, temperature: 22.5, gravity: 1.04 })
      .expect(200);

    const agentB = request.agent(app);
    await login(agentB, USER_B, PASS);
    const devicesB = await agentB.get('/api/ispindel/devices').expect(200);
    assert.ok(!devicesB.body.devices.some((d) => d.name === 'A-only'));

    await agentB.get('/api/ispindel/readings?token_id=' + owned.id).expect(404);

    const agentAdmin = request.agent(app);
    await login(agentAdmin, ADMIN, PASS);
    const devicesAdmin = await agentAdmin.get('/api/ispindel/devices').expect(200);
    assert.ok(devicesAdmin.body.devices.some((d) => d.name === 'A-only'));
  });

  it('accepts Bearer header for device ingest', async () => {
    const plain = await tokensLib.createToken('header-device', userAId, 'device');
    await request(app)
      .post('/api/ispindel')
      .set('Authorization', 'Bearer ' + plain.token)
      .send({ temperature: 19.9, gravity: 1.02 })
      .expect(200);
  });
});
