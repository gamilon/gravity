/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('ispindel_readings', (t) => {
    t.increments('id').primary();
    t.integer('api_token_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('api_tokens')
      .onDelete('CASCADE');
    t.string('device_name', 128);
    t.string('chip_id', 64);
    t.float('temperature').notNullable();
    t.string('temp_units', 8).defaultTo('C');
    t.float('gravity');
    t.float('angle');
    t.float('battery');
    t.float('rssi');
    t.integer('interval_sec');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['api_token_id', 'created_at']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('ispindel_readings');
};
