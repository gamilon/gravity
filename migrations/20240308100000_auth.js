/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .createTable('users', (t) => {
      t.increments('id').primary();
      t.string('username', 64).notNullable().unique();
      t.string('password_hash', 255).notNullable();
      t.timestamps(true, true);
    })
    .then(() =>
      knex.schema.createTable('groups', (t) => {
        t.increments('id').primary();
        t.string('name', 64).notNullable().unique();
      })
    )
    .then(() =>
      knex.schema.createTable('user_groups', (t) => {
        t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.integer('group_id').unsigned().notNullable().references('id').inTable('groups').onDelete('CASCADE');
        t.primary(['user_id', 'group_id']);
      })
    );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('user_groups')
    .then(() => knex.schema.dropTableIfExists('groups'))
    .then(() => knex.schema.dropTableIfExists('users'));
};
