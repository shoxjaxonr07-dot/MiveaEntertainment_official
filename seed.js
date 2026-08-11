/**
 * Seeds a demo staff account so the admin dashboard's login has something
 * real to authenticate against once it's wired up to this server.
 * Run: npm run seed
 */
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'mivea.db');
const db = new Database(DB_PATH);
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const email = 'admin@mivea.demo';
const existing = db.prepare('SELECT id FROM staff WHERE email = ?').get(email);

if (existing) {
  console.log('Demo staff account already exists:', email);
} else {
  const hash = bcrypt.hashSync('mivea2026', 10);
  db.prepare('INSERT INTO staff (id, name, email, password_hash, role) VALUES (?,?,?,?,?)')
    .run(uuidv4(), 'Demo Admin', email, hash, 'administrator');
  console.log('Created demo staff account:');
  console.log('  email:    ' + email);
  console.log('  password: mivea2026');
}
