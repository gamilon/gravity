const knex = require('knex');
const path = require('path');

const config = require('./knexfile')[process.env.NODE_ENV || 'development'];

const db = knex(config);

async function ensureMigrations() {
  await db.migrate.latest();
}

module.exports = db;
module.exports.ensureMigrations = ensureMigrations;
