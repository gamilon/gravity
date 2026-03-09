/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('api_tokens', (t) => {
    t.increments('id').primary();
    t.string('name', 128).notNullable();
    t.string('token_hash', 64).notNullable(); // SHA-256 hex
    t.string('token_prefix', 16).notNullable(); // first N chars for identification
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('last_used_at');
    t.timestamps(true, true);
    t.unique('token_hash');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('api_tokens');
};
