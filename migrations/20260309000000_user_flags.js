/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // SQLite supports ADD COLUMN but not DROP COLUMN in ALTER TABLE prior to 3.35.
  // Here we only add a new non-nullable boolean with default false.
  await knex.schema.alterTable('users', (t) => {
    t.boolean('disabled').notNullable().defaultTo(false);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  // For SQLite, dropping a column would require table recreation.
  // To keep the migration simple and safe, we leave the column in place.
  return Promise.resolve();
};

