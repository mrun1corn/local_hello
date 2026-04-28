const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const Bonjour = require('bonjour-service');
const Database = require('better-sqlite3');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

if (!fs.existsSync('./data')) fs.mkdirSync('./data');

const db = new Database('./data/chat.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender TEXT NOT NULL,
    sender_id TEXT,
    receiver_id TEXT,
    color TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    is_read BOOLEAN DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blocks (
    blocker_id TEXT NOT NULL,
    blocked_id TEXT NOT NULL,
    PRIMARY KEY(blocker_id, blocked_id)
  );
`);

app.prepare().then(() => {
  const server = createServer((req, res) => {
    try { handle(req, res, parse(req.url, true)); } catch (err) { res.statusCode = 500; res.end(); }
  });

  try {
    const bonjour = new Bonjour.Bonjour();
    bonjour.publish({ name: 'LocalChat', type: 'http', port });
  } catch (e) {}

  server.listen(port, '0.0.0.0', () => console.log(`Ready on port ${port}`));
});
