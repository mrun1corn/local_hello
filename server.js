require('dotenv').config();
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();
const port = process.env.PORT || 3000;

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}

const dbPath = path.join(process.cwd(), 'data', 'chat.db');
const db = new Database(dbPath);

const clients = new Map();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);
    // Let Next.js handle all requests, including APIs
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  const originalEmit = server.emit;
  server.emit = function (event, ...args) {
    if (event === 'upgrade') {
      const [request, socket, head] = args;
      const { pathname } = parse(request.url);
      if (pathname === '/') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
        return true;
      }
    }
    return originalEmit.apply(this, [event, ...args]);
  };

  wss.on('connection', (ws) => {
    let currentUserId = null;

    ws.on('message', async (message) => {
      try {
        console.log(`[WS] Received raw message: ${message.toString()}`);
        const { type, data, token } = JSON.parse(message);
        console.log(`[WS] Parsed type: ${type}, has currentUserId: ${!!currentUserId}`);
        
        // Skip auth for read/edit/etc if not authenticated yet, 
        // but 'auth' type handles the initial verification.
        if (type === 'auth') {
          try {
            try {
              const decodedToken = await admin.auth().verifyIdToken(token);
              uid = decodedToken.uid;
            } catch (e) {
              if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
                uid = (data && data.id) ? data.id : token;
              } else {
                throw e;
              }
            }
            currentUserId = uid;
            clients.set(currentUserId, ws);
            console.log(`[WS] User verified and connected: ${currentUserId}`);
            
            // Re-sync queue or send welcome? 
            ws.send(JSON.stringify({ type: 'verified' }));
          } catch (e) {
            console.error('[WS] Auth failed:', e.message);
            ws.close();
          }
          return;
        }

        if (!currentUserId) return;

        switch (type) {
          case 'chat':
            // Check if sender is blocked by receiver
            const blockCheck = db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(data.receiver_id, currentUserId);
            if (blockCheck) {
              console.log(`[SERVER] Message blocked from ${currentUserId} to ${data.receiver_id}`);
              break;
            }

            const stmt = db.prepare('INSERT INTO messages (id, sender, sender_id, receiver_id, color, content, timestamp, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            stmt.run(data.id, data.sender, currentUserId, data.receiver_id, data.color, data.content, data.timestamp || Date.now(), data.isGroup ? 'group' : 'text');
            
            if (data.isGroup) {
              const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(data.receiver_id);
              const memberIds = new Set(members.map(m => m.user_id));
              
              clients.forEach((clientWs, userId) => {
                if (userId !== currentUserId && memberIds.has(userId) && clientWs.readyState === 1) {
                  clientWs.send(JSON.stringify({ type: 'chat', data }));
                }
              });
            } else {
              const receiverWs = clients.get(data.receiver_id);
              if (receiverWs && receiverWs.readyState === 1) {
                receiverWs.send(JSON.stringify({ type: 'chat', data }));
              }
            }
            break;
          case 'read':
             db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').run(data.id);
             const senderWs = clients.get(data.receiver_id);
             if (senderWs && senderWs.readyState === 1) {
               senderWs.send(JSON.stringify({ type: 'read', data: { id: data.id } }));
             }
             break;
          case 'edit':
             db.prepare('UPDATE messages SET content = ? WHERE id = ? AND sender_id = ?').run(data.content, data.id, currentUserId);
             const editWs = clients.get(data.receiver_id);
             if (editWs && editWs.readyState === 1) {
               editWs.send(JSON.stringify({ type: 'edit', data }));
             }
             break;
          case 'delete':
             db.prepare('DELETE FROM messages WHERE id = ? AND sender_id = ?').run(data.id, currentUserId);
             const deleteWs = clients.get(data.receiver_id);
             if (deleteWs && deleteWs.readyState === 1) {
               deleteWs.send(JSON.stringify({ type: 'delete', data }));
             }
             break;
          case 'typing':
             const typingWs = clients.get(data.receiver_id);
             if (typingWs && typingWs.readyState === 1) {
               typingWs.send(JSON.stringify({ type: 'typing', data: { sender: data.sender, sender_id: currentUserId } }));
             }
             break;
        }
      } catch (err) {
        console.error('[WS] Error:', err);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[WS] Connection closed for: ${currentUserId}, code: ${code}, reason: ${reason}`);
      if (currentUserId) {
        clients.delete(currentUserId);
      }
    });

    ws.on('error', (err) => {
      console.error(`[WS] Connection error for: ${currentUserId}:`, err);
    });
  });

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://localhost:${port}`);
  });
});
