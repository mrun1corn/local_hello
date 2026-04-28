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
  const apiPath = path.join(process.cwd(), 'src', 'api', pathname.replace('/api/', ''), 'route.js');
  
  if (fs.existsSync(apiPath)) {
    try {
      const module = require(apiPath);
      if (module[method]) {
        // Mocking the Next.js Response object and Request object for simple route handlers
        if (method === 'GET') {
          const result = await module.GET({ url: `http://localhost${req.url}` });
          const json = await result.json();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(json));
          return true;
        }
      }
    } catch (err) {
      console.error('API execution error:', err);
    }
  }
  return false;
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);
    const { pathname } = parsedUrl;

    if (pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, pathname);
      if (handled) return;
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
            const stmt = db.prepare('INSERT INTO messages (id, sender, sender_id, receiver_id, color, content, timestamp, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            stmt.run(data.id, data.sender, data.sender_id, data.receiver_id, data.color, data.content, data.timestamp || Date.now(), data.isGroup ? 'group' : 'text');
            clients.forEach((clientWs, userId) => {
              if (userId !== data.sender_id && clientWs.readyState === 1) {
                clientWs.send(JSON.stringify({ type: 'chat', data }));
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
