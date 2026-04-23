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

// Global error handling to prevent crashes from internal library errors (like WS frame errors)
process.on('uncaughtException', (err) => {
  if (err.code === 'WS_ERR_INVALID_CLOSE_CODE' || err.message.includes('Invalid WebSocket frame')) {
    console.error('Caught and suppressed WebSocket frame error:', err.message);
  } else {
    console.error('Uncaught Exception:', err);
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0'; // Bind to all interfaces
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Ensure db directory exists
if (!fs.existsSync('./data')) {
  fs.mkdirSync('./data');
}

// Initialize SQLite Database
const db = new Database('./data/chat.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender TEXT NOT NULL,
    color TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );
`);

const insertMsg = db.prepare('INSERT INTO messages (id, sender, color, content, timestamp) VALUES (?, ?, ?, ?, ?)');
const updateMsg = db.prepare('UPDATE messages SET content = ? WHERE id = ?');
const deleteMsg = db.prepare('DELETE FROM messages WHERE id = ?');
const getRecentMsgs = db.prepare('SELECT * FROM messages ORDER BY timestamp DESC LIMIT 50');

app.prepare().then(() => {
  const server = createServer((req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      // Let Next.js handle all other routes
      handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Setup WebSocket Server
  const wss = new WebSocketServer({ server });

  wss.on('error', (err) => {
    console.error('WebSocket Server Error:', err);
  });
  
  // Broadcaster for other clients
  const broadcast = (message, senderWs) => {
    wss.clients.forEach((client) => {
      if (client !== senderWs && client.readyState === 1) { // 1 = OPEN
        client.send(JSON.stringify(message));
      }
    });
  };

  wss.on('connection', (ws) => {
    // Individual socket error handling
    ws.on('error', (err) => {
      console.error('Individual WebSocket Error:', err.message);
    });

    // Send message history to the new client
    const history = getRecentMsgs.all().reverse(); // Show oldest first
    ws.send(JSON.stringify({ type: 'history', data: history }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'chat') {
          // ... (existing chat logic)
          // Add server timestamp and ID if missing
          const chatData = {
            id: msg.data.id || crypto.randomUUID(),
            sender: msg.data.sender || 'Anonymous',
            color: msg.data.color || '#3b82f6',
            content: msg.data.content,
            timestamp: msg.data.timestamp || Date.now()
          };

          // Save to DB
          try {
            // 1. Save to Local SQLite
            insertMsg.run(chatData.id, chatData.sender, chatData.color, chatData.content, chatData.timestamp);

            // 2. Sync to Supabase Cloud
            supabase.from('messages').insert([chatData]).then(({ error }) => {
              if (error) console.warn('Cloud sync failed (offline?):', error.message);
            });

            // Broadcast to everyone else
            broadcast({ type: 'chat', data: chatData }, ws);
            
            // Send ack back to sender
            ws.send(JSON.stringify({ type: 'ack', id: chatData.id }));
          } catch (dbErr) {
            console.error('Database or Broadcast error:', dbErr);
            ws.send(JSON.stringify({ type: 'error', message: 'Failed to process message' }));
          }
        } else if (msg.type === 'edit') {
          try {
            updateMsg.run(msg.data.content, msg.data.id);
            supabase.from('messages').update({ content: msg.data.content }).eq('id', msg.data.id).then(({error}) => {
               if (error) console.warn('Cloud edit sync failed');
            });
            broadcast({ type: 'edit', data: msg.data }, ws);
          } catch (e) { console.error('Edit error:', e); }
        } else if (msg.type === 'delete') {
          try {
            deleteMsg.run(msg.data.id);
            supabase.from('messages').delete().eq('id', msg.data.id).then(({error}) => {
               if (error) console.warn('Cloud delete sync failed');
            });
            broadcast({ type: 'delete', data: msg.data }, ws);
          } catch (e) { console.error('Delete error:', e); }
        } else if (msg.type === 'typing') {
          broadcast({ type: 'typing', data: msg.data }, ws);
        }
      } catch (e) {
        console.error('Failed to process message', e);
      }
    });
  });

  // Setup mDNS (Bonjour)
  let bonjour;
  try {
    bonjour = new Bonjour.Bonjour();
    bonjour.publish({ name: 'LocalChat', type: 'http', port });
    console.log('📡 mDNS Broadcast active as _http._tcp (LocalChat.local)');
  } catch (e) {
    console.error('Failed to start mDNS broadcast:', e);
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down...');
    if (bonjour) {
      bonjour.unpublishAll(() => {
        bonjour.destroy();
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.once('error', (err) => {
    console.error(err);
    process.exit(1);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`> Ready on http://0.0.0.0:${port}`);
    console.log(`> Also accessible on your network at http://<your-ip>:${port}`);
  });
});
