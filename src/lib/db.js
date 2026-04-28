import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.join(process.cwd(), 'data', 'chat.db');
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

// better-sqlite3 handles concurrent connections gracefully, 
// especially with WAL mode enabled.
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

export default db;
