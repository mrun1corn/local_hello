import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.join(process.cwd(), 'data', 'chat.db');

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// Helper to add column if it doesn't exist
function addColumnIfNotExists(table, column, definition) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!info.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    username TEXT,
    color TEXT,
    bio TEXT,
    last_seen INTEGER
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender TEXT,
    content TEXT,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    sender_id TEXT,
    receiver_id TEXT,
    status TEXT,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS blocks (
    blocker_id TEXT,
    blocked_id TEXT,
    PRIMARY KEY (blocker_id, blocked_id)
  );
`);

// Migration: ensure all columns exist in messages
addColumnIfNotExists('messages', 'sender_id', 'TEXT');
addColumnIfNotExists('messages', 'receiver_id', 'TEXT');
addColumnIfNotExists('messages', 'color', 'TEXT');
addColumnIfNotExists('messages', 'is_read', 'INTEGER DEFAULT 0');
addColumnIfNotExists('messages', 'type', 'TEXT DEFAULT "text"');

export default db;
