# Gravity

A minimal web app to self-host on a Raspberry Pi and use from any browser.

## Run locally

```bash
cd gravity
npm install
npm run migrate
ADMIN_PASSWORD=your-secure-password npm run seed   # create admin user (optional: ADMIN_USERNAME=admin)
npm start
```

Open http://localhost:3000 (or http://\<your-pi-ip\>:3000 from another device). Log in with the username and password you set in the seed step.

## CI and tests

```bash
npm test
```

GitHub Actions on `main` runs `npm ci`, `npm audit --audit-level=high`, and the test suite (Node 24). Requires Node.js 22+.

**Supply-chain hygiene:** installs use the committed lockfile (`npm ci`). `.npmrc` sets `min-release-age=14` so brand-new publishes are skipped (npm ≥ 11.10). Dependabot opens weekly update PRs with a 14-day cooldown on version bumps; security updates are not delayed. Review those PRs before merging.

## Run on Raspberry Pi

1. Copy the project to the Pi (e.g. `scp -r gravity pi@<pi-ip>:~`).
2. On the Pi, install build tools if needed (for the SQLite native module), then install, seed, and run:
   ```bash
   sudo apt install -y build-essential
   cd gravity
   npm install --omit=dev
   npm run migrate
   ADMIN_PASSWORD=your-secure-password npm run seed
   SESSION_SECRET=your-random-secret npm start
   ```
3. From your browser, go to `http://<pi-ip>:3000` and log in.

### Run on boot (systemd)

Create `/etc/systemd/system/gravity.service`:

```ini
[Unit]
Description=Gravity
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/gravity
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=PORT=3000
Environment=NODE_ENV=production
Environment=SESSION_SECRET=your-random-secret

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable gravity
sudo systemctl start gravity
```

### Optional: reverse proxy (TLS)

To serve on port 80/443 with nginx or Caddy, proxy to `http://127.0.0.1:3000`.

When the reverse proxy terminates TLS, set **`TRUST_PROXY=1`** so Express trusts `X-Forwarded-*` headers (correct client IPs for rate limiting) and marks the session cookie **`Secure`**. Example systemd extras:

```ini
Environment=TRUST_PROXY=1
```

Only enable `TRUST_PROXY` when Gravity sits behind a trusted proxy; otherwise clients could spoof forwarded headers.

## Project layout

- `server.js` – Express server; auth, API routes. HTML pages are served only via guarded routes.
- `auth.js` – Session helpers and `requireAuth` / `requireAdmin` / `requireApiToken` / `requireDeviceToken` middleware.
- `public/` – Frontend assets. HTML is not served by static file middleware; CSS/JS are.
- `public/js/` – Shared (`common.js`) and per-page scripts.
- `GET /login`, `POST /api/login`, `POST /api/logout`, `GET /api/me` – Auth.
- `GET /api/status` – Health check (JSON); requires login.

## Authentication

- All app routes require login. The first user is created by seed and belongs to the **admin** group.
- Set **SESSION_SECRET** in production (e.g. a long random string). The app **refuses to start** when `NODE_ENV=production` and the default secret is used.
- Login regenerates the session (prevents session fixation). Disabled accounts are rejected on every authenticated request, not only at login.
- **Login** is rate-limited (10 attempts per 15 minutes per IP). Password changes and sensitive admin/token creates are rate-limited (30 / 15 min). New user and password-change require a password of at least 8 characters.
- **API tokens** come in two kinds: **device** (any logged-in user, own tokens) and **admin** (admins only). Secrets are shown once, stored hashed. Prefer headers (`Authorization: Bearer` or `X-API-Key`); iSpindel may send `token` in the JSON body. Do not put tokens in URLs. Tokens belonging to disabled users are rejected.
- Create the admin user once: `ADMIN_USERNAME=admin ADMIN_PASSWORD=your-password npm run seed`. The seed only runs if no users exist.
- Use `requireAdmin` in `server.js` for routes that should be restricted to the admin group.
- **Logging**: Logs go to stdout/stderr and to `logs/gravity.log` by default. Configure with `LOG_LEVEL` (`error`, `warn`, `info`, `debug`), `LOG_DIR`, and `LOG_FILE`.

## iSpindel

1. Log in and open **/tokens**. Create one **device token** per physical iSpindel (e.g. `Ferm fridge`).
2. Copy the one-time secret into the iSpindel **Token** field.
3. Point the device at your Gravity host:
   - Service: **HTTP** (or HTTPS if you terminate TLS at a reverse proxy)
   - Server / IP: your Pi or hostname
   - Port: `3000` (or `443` behind TLS proxy)
   - Path / URI: **`/api/ispindel`**
4. Open **/ispindel** to see latest readings and recent history. Each token is a separate device stream.

Keep Gravity on a trusted LAN or behind TLS (`TRUST_PROXY=1` when the proxy terminates HTTPS).

## Customize

- **Database**: SQLite by default; data is stored in `data/gravity.sqlite3`. To switch to Postgres, set `DATABASE_URL` (e.g. `postgres://user:pass@host/dbname`) and add the `pg` package, then run `npm run migrate`.
- **Migrations**: Run `npm run migrate` to apply migrations; `npm run migrate:rollback` to roll back one batch.
- **Seeds**: Run `npm run seed` with `ADMIN_PASSWORD` (and optionally `ADMIN_USERNAME`) to create the admin group and one admin user. Safe to run again; it no-ops if users already exist.
- Edit `public/index.html`, `public/styles.css`, and scripts under `public/js/` for the UI.
- Add routes in `server.js` for APIs or server-rendered pages.
