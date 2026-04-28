const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');
const Database = require('better-sqlite3');
const path = require('path');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();
const port = process.env.PORT || 3000;

// Database connection for WebSocket logic
const dbPath = path.join(process.cwd(), 'data', 'chat.db');
const db = new Database(dbPath);

const clients = new Map(); // userId -> ws

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let currentUserId = null;

    ws.on('message', (message) => {
      const { type, data } = JSON.parse(message);

      switch (type) {
        case 'auth':
          currentUserId = data.id;
          clients.set(currentUserId, ws);
          console.log(`User authenticated: ${currentUserId}`);
          break;

        case 'chat':
          // data: { sender, sender_id, receiver_id, content, color, id, timestamp, isGroup }
          try {
            const stmt = db.prepare('INSERT INTO messages (id, sender, sender_id, receiver_id, color, content, timestamp, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            stmt.run(data.id, data.sender, data.sender_id, data.receiver_id, data.color, data.content, data.timestamp || Date.now(), data.isGroup ? 'group' : 'text');
            
            if (data.isGroup) {
              // Simple group logic: if it's a group message, we might need a list of members.
              // For now, let's broadcast to everyone EXCEPT the sender if they are in the 'groups' table
              // Or just broadcast to everyone online for simplicity in this local dev stage
              clients.forEach((clientWs, userId) => {
                if (userId !== data.sender_id && clientWs.readyState === 1) {
                  clientWs.send(JSON.stringify({ type: 'chat', data }));
                }
              });
            } else {
              // Push to receiver if online
              const receiverWs = clients.get(data.receiver_id);
              if (receiverWs && receiverWs.readyState === 1) {
                receiverWs.send(JSON.stringify({ type: 'chat', data }));
              }
            }
          } catch (err) {
            console.error('DB Error in chat:', err);
          }
          break;

        case 'typing':
          const tWs = clients.get(data.receiver_id);
          if (tWs) tWs.send(JSON.stringify({ type: 'typing', data: { sender_id: currentUserId } }));
          break;

        case 'read':
          db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').run(data.id);
          const rWs = clients.get(data.receiver_id);
          if (rWs) rWs.send(JSON.stringify({ type: 'read', data: { id: data.id } }));
          break;
      }
    });

    ws.on('close', () => {
      if (currentUserId) clients.delete(currentUserId);
    });
  });

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://localhost:${port}`);
  });
});
