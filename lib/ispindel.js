const db = require('../db');

function asNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asString(value, maxLen) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

/**
 * Parse and validate an iSpindel JSON body into a DB row (without api_token_id).
 * Requires temperature.
 */
function parseReading(body) {
  const temperature = asNumber(body?.temperature);
  if (temperature == null) {
    return { error: 'temperature is required and must be a number' };
  }
  const chipRaw = body?.ID ?? body?.id;
  return {
    reading: {
      device_name: asString(body?.name, 128),
      chip_id: asString(chipRaw, 64),
      temperature,
      temp_units: asString(body?.temp_units ?? body?.['temp-units'], 8) || 'C',
      gravity: asNumber(body?.gravity),
      angle: asNumber(body?.angle),
      battery: asNumber(body?.battery),
      rssi: asNumber(body?.RSSI ?? body?.rssi),
      interval_sec: asNumber(body?.interval) != null ? Math.round(asNumber(body.interval)) : null,
    },
  };
}

async function insertReading(apiTokenId, reading) {
  const [id] = await db('ispindel_readings').insert({
    api_token_id: apiTokenId,
    ...reading,
  });
  return id;
}

/**
 * Latest reading per device token the viewer may see.
 * @param {{ userId: number, isAdmin: boolean }} viewer
 */
async function listDevicesWithLatest(viewer) {
  let tokenQuery = db('api_tokens')
    .select(
      'api_tokens.id',
      'api_tokens.name',
      'api_tokens.token_prefix',
      'api_tokens.user_id',
      'api_tokens.last_used_at',
      'users.username as owner_username'
    )
    .leftJoin('users', 'users.id', 'api_tokens.user_id')
    .where({ 'api_tokens.kind': 'device' })
    .orderBy('api_tokens.name', 'asc');
  if (!viewer.isAdmin) {
    tokenQuery = tokenQuery.where({ 'api_tokens.user_id': viewer.userId });
  }
  const tokenRows = await tokenQuery;

  const devices = [];
  for (const t of tokenRows) {
    const latest = await db('ispindel_readings')
      .where({ api_token_id: t.id })
      .orderBy('created_at', 'desc')
      .first();
    devices.push({
      id: t.id,
      name: t.name,
      token_prefix: t.token_prefix,
      user_id: t.user_id,
      owner_username: t.owner_username,
      last_used_at: t.last_used_at,
      latest: latest
        ? {
            id: latest.id,
            device_name: latest.device_name,
            chip_id: latest.chip_id,
            temperature: latest.temperature,
            temp_units: latest.temp_units,
            gravity: latest.gravity,
            angle: latest.angle,
            battery: latest.battery,
            rssi: latest.rssi,
            interval_sec: latest.interval_sec,
            created_at: latest.created_at,
          }
        : null,
    });
  }
  return devices;
}

async function canAccessDeviceToken(tokenId, viewer) {
  const token = await db('api_tokens').where({ id: tokenId, kind: 'device' }).first();
  if (!token) return null;
  if (!viewer.isAdmin && token.user_id !== viewer.userId) return null;
  return token;
}

async function listReadings(tokenId, limit) {
  return db('ispindel_readings')
    .where({ api_token_id: tokenId })
    .orderBy('created_at', 'desc')
    .limit(limit);
}

module.exports = {
  parseReading,
  insertReading,
  listDevicesWithLatest,
  canAccessDeviceToken,
  listReadings,
};
