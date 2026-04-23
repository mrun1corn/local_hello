const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');
const Bonjour = require('bonjour-service');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''
);

// Global error handling
process.on('uncaughtException', (err) => {
  if (err.code === 'WS_ERR_INVALID_CLOSE_CODE' || err.message.includes('Invalid WebSocket frame')) {
    console.error('WebSocket frame error suppressed');
  } else {
    console.error('Uncaught Exception:', err);
    process.exit(1);
  }
});

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

if (!fs.existsSync('./data')) fs.mkdirSync('./data');

const db = new Database('./data/chat.db');
db.exec(`
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

const insertMsg = db.prepare('INSERT INTO messages (id, sender, sender_id, receiver_id, color, content, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)');
const markRead = db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?');
const updateMsg = db.prepare('UPDATE messages SET content = ? WHERE id = ?');
const deleteMsg = db.prepare('DELETE FROM messages WHERE id = ?');
const addBlock = db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)');
const checkBlocked = db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?');

app.prepare().then(() => {
  const server = createServer((req, res) => {
    try { handle(req, res, parse(req.url, true)); } catch (err) { res.statusCode = 500; res.end(); }
  });

  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth') { ws.user_id = msg.data.id; return; }

        if (msg.type === 'chat') {
          // Check if receiver has blocked sender
          if (checkBlocked.get(msg.data.receiver_id, ws.user_id)) return;

          const chatData = { ...msg.data, timestamp: Date.now() };
          try {
            insertMsg.run(chatData.id, chatData.sender, ws.user_id, chatData.receiver_id, chatData.color, chatData.content, chatData.timestamp);
            supabase.from('messages').insert([chatData]).then(() => {});
            wss.clients.forEach(c => {
              if (c.readyState === 1 && (c.user_id === chatData.receiver_id || c.user_id === ws.user_id)) {
                if (c !== ws) c.send(JSON.stringify({ type: 'chat', data: chatData }));
              }
            });
            ws.send(JSON.stringify({ type: 'ack', id: chatData.id }));
          } catch (e) { console.error(e); }
        } else if (msg.type === 'read') {
          markRead.run(msg.data.id);
          supabase.from('messages').update({ is_read: true }).eq('id', msg.data.id).then(() => {});
          wss.clients.forEach(c => {
            if (c.readyState === 1 && c.user_id === msg.data.receiver_id) c.send(JSON.stringify(msg));
          });
        } else if (msg.type === 'block') {
          addBlock.run(ws.user_id, msg.data.blocked_id);
          supabase.from('blocked_users').insert([{ blocker_id: ws.user_id, blocked_id: msg.data.blocked_id }]).then(() => {});
        } else {
          wss.clients.forEach(c => {
            if (c.readyState === 1 && c.user_id === msg.data.receiver_id) c.send(JSON.stringify(msg));
          });
        }
      } catch (e) { console.error(e); }
    });
  });

  try {
    const BonjourService = require('bonjour-service');
    const bonjour = new BonjourService.Bonjour();
    bonjour.publish({ name: 'LocalChat', type: 'http', port });
  } catch (e) {}

  server.listen(port, '0.0.0.0', () => console.log(`Ready on port ${port}`));
});
