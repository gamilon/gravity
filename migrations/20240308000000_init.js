/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  // Add your schema changes here. Example:
  // return knex.schema.createTable('items', (t) => {
  //   t.increments('id').primary();
  //   t.string('name').notNullable();
  //   t.timestamps(true, true);
  // });
  return Promise.resolve();
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return Promise.resolve();
};
