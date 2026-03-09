const bcrypt = require('bcryptjs');

/**
 * Creates the admin group and one admin user from env (ADMIN_USERNAME, ADMIN_PASSWORD).
 * Only runs if no users exist. Set env vars before running: npm run seed
 */
exports.seed = async function (knex) {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error('Set ADMIN_PASSWORD (and optionally ADMIN_USERNAME) before running seed');
  }

  const existing = await knex('users').first();
  if (existing) {
    return;
  }

  await knex('groups').insert({ name: 'admin' });
  const adminGroup = await knex('groups').where({ name: 'admin' }).first();

  const password_hash = await bcrypt.hash(password, 12);
  await knex('users').insert({ username, password_hash });
  const user = await knex('users').where({ username }).first();

  await knex('user_groups').insert({ user_id: user.id, group_id: adminGroup.id });
};
