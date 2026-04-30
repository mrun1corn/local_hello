const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();
const port = process.env.PORT || 3000;

const dbPath = path.join(process.cwd(), 'data', 'chat.db');
const db = new Database(dbPath);

const clients = new Map();

// Helper to handle API routes manually since they are outside 'app' for static export compatibility
async function handleApi(req, res, pathname) {
  const method = req.method;
  const relativePath = pathname.replace('/api/', '');
  const apiPath = path.join(process.cwd(), 'src', 'api', relativePath, 'route.js');
  
  console.log(`[DEBUG] API Request: ${method} ${pathname}`);
  console.log(`[DEBUG] Resolved Path: ${apiPath}`);
  
  if (fs.existsSync(apiPath)) {
    console.log(`[DEBUG] File exists!`);
    try {
      delete require.cache[require.resolve(apiPath)];
      const module = require(apiPath);
      if (module[method]) {
        console.log(`[DEBUG] Method ${method} found in module.`);
        if (method === 'GET') {
          const result = await module.GET({ 
            url: `http://localhost:${port}${req.url}`,
            headers: req.headers
          });
          const json = await result.json();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(json));
          return true;
        } else if (method === 'POST') {
          let body = '';
          return new Promise((resolve) => {
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
              try {
                console.log(`[DEBUG] Body received, calling POST handler...`);
                const result = await module.POST({ 
                  json: async () => JSON.parse(body),
                  url: `http://localhost:${port}${req.url}`,
                  headers: req.headers
                });
                const json = await result.json();
                console.log(`[DEBUG] POST handler success:`, json);
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = result.status || 200;
                res.end(JSON.stringify(json));
                resolve(true);
              } catch (e) {
                console.error('[DEBUG] POST error:', e);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: e.message }));
                resolve(true);
              }
            });
          });
        }
      } else {
        console.log(`[DEBUG] Method ${method} NOT found in module.`);
      }
    } catch (err) {
      console.error('[DEBUG] API execution error:', err);
    }
  } else {
    console.log(`[DEBUG] File does NOT exist at: ${apiPath}`);
  }
  return false;
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);
    const { pathname } = parsedUrl;

    console.log(`[SERVER] Request: ${req.method} ${req.url} -> Pathname: ${pathname}`);

    if (pathname && pathname.startsWith('/api/')) {
      console.log(`[SERVER] Intercepting API path: ${pathname}`);
      const handled = await handleApi(req, res, pathname);
      if (handled) {
        console.log(`[SERVER] API path ${pathname} handled by custom logic.`);
        return;
      }
      console.log(`[SERVER] API path ${pathname} NOT handled by custom logic, passing to Next.js.`);
    }

    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let currentUserId = null;
    ws.on('message', (message) => {
      try {
        const { type, data } = JSON.parse(message);
        switch (type) {
          case 'auth':
            currentUserId = data.id;
            clients.set(currentUserId, ws);
            break;
          case 'chat':
            // Check if sender is blocked by receiver
            const blockCheck = db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(data.receiver_id, data.sender_id);
            if (blockCheck) {
              console.log(`[SERVER] Message blocked from ${data.sender_id} to ${data.receiver_id}`);
              break;
            }

            const stmt = db.prepare('INSERT INTO messages (id, sender, sender_id, receiver_id, color, content, timestamp, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            stmt.run(data.id, data.sender, data.sender_id, data.receiver_id, data.color, data.content, data.timestamp || Date.now(), data.isGroup ? 'group' : 'text');
            
            if (data.isGroup) {
              // Group broadcast: send to all members (who are currently connected locally)
              // Ideally we'd check group membership here, but for local-first we broadcast to all
              // since local server might not have full group info. Filtering happens in UI.
              clients.forEach((clientWs, userId) => {
                if (userId !== data.sender_id && clientWs.readyState === 1) {
                  clientWs.send(JSON.stringify({ type: 'chat', data }));
                }
              });
            } else {
              // Private message: only send to the intended receiver
              const receiverWs = clients.get(data.receiver_id);
              if (receiverWs && receiverWs.readyState === 1) {
                receiverWs.send(JSON.stringify({ type: 'chat', data }));
              }
            }
            break;
          case 'read':
             const readStmt = db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?');
             readStmt.run(data.id);
             // Notify sender that message was read
             const senderWs = clients.get(data.receiver_id); // receiver_id in the 'read' event is the original sender
             if (senderWs && senderWs.readyState === 1) {
               senderWs.send(JSON.stringify({ type: 'read', data: { id: data.id } }));
             }
             break;
          case 'edit':
             const editStmt = db.prepare('UPDATE messages SET content = ? WHERE id = ?');
             editStmt.run(data.content, data.id);
             clients.forEach((clientWs, userId) => {
               if (userId === data.receiver_id && clientWs.readyState === 1) {
                 clientWs.send(JSON.stringify({ type: 'edit', data }));
               }
             });
             break;
          case 'delete':
             const delStmt = db.prepare('DELETE FROM messages WHERE id = ?');
             delStmt.run(data.id);
             clients.forEach((clientWs, userId) => {
               if (userId === data.receiver_id && clientWs.readyState === 1) {
                 clientWs.send(JSON.stringify({ type: 'delete', data }));
               }
             });
             break;
        }
      } catch (err) { console.error('WS error:', err); }
    });
    ws.on('close', () => { if (currentUserId) clients.delete(currentUserId); });
  });

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://localhost:${port}`);
  });
});
