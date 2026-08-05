/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('api_tokens', (t) => {
    t.string('kind', 16).notNullable().defaultTo('admin');
  });
  // Existing tokens were admin-created
  await knex('api_tokens').update({ kind: 'admin' });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('api_tokens', (t) => {
    t.dropColumn('kind');
  });
};
