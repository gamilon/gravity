const path = require('path');

const sqliteBase = {
  client: 'better-sqlite3',
  useNullAsDefault: true,
  migrations: {
    directory: path.join(__dirname, 'migrations'),
  },
  seeds: {
    directory: path.join(__dirname, 'seeds'),
  },
};

module.exports = {
  development: {
    ...sqliteBase,
    connection: {
      filename: path.join(__dirname, 'data', 'pi-app.sqlite3'),
    },
  },
  test: {
    ...sqliteBase,
    connection: {
      filename: path.join(__dirname, 'data', 'gravity-test.sqlite3'),
    },
  },
  production: {
    client: process.env.DATABASE_URL ? 'pg' : 'better-sqlite3',
    connection: process.env.DATABASE_URL || {
      filename: path.join(__dirname, 'data', 'pi-app.sqlite3'),
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, 'migrations'),
    },
    seeds: {
      directory: path.join(__dirname, 'seeds'),
    },
  },
};
