const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'glomart.sqlite');
const SCHEMA_PATH = process.env.SCHEMA_PATH || path.join(__dirname, 'schema.sql');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new sqlite3.Database(DB_PATH);
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema, (err) => {
  if (err) {
    console.error('[GLOMART DB INIT ERROR]', err);
    process.exit(1);
  }
  console.log('[GLOMART DB READY]', DB_PATH);
  db.close();
});
