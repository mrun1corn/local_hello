export class ChatClient {
  constructor(onMessage, onStatusChange) {
    this.onMessage = onMessage;
    this.onStatusChange = onStatusChange;
    this.ws = null;
    this.isOnline = false;
    this.pollInterval = null;
    this.queue = [];
    this.wsRetryCount = 0;
    this.maxWsRetries = 3;
    this.usePolling = false;
    
    this.init();
  }

  async init() {
    this.loadQueueFromDB();
    
    // Check if we are running locally (development) or a local IP
    const isLocal = typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || 
       window.location.hostname === '127.0.0.1' || 
       window.location.hostname.endsWith('.local') ||
       window.location.hostname.startsWith('192.168.') ||
       window.location.hostname.startsWith('10.') ||
       /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(window.location.hostname));

    if (isLocal) {
      this.connectWebSocket();
    } else {
      // Vercel deployment mode (Polling fallback)
      this.usePolling = true;
      this.startPolling();
    }
    
    window.addEventListener('online', () => this.syncQueue());
  }

  // --- LOCAL MODE (WebSockets) ---
  connectWebSocket() {
    if (this.usePolling) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    console.log(`Attempting WebSocket connection to ${wsUrl}...`);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected successfully');
      this.isOnline = true;
      this.wsRetryCount = 0;
      this.onStatusChange(true);
      this.syncQueue();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'history') {
          msg.data.forEach(m => this.onMessage(m));
        } else if (msg.type === 'chat') {
          this.onMessage(msg.data);
        } else if (msg.type === 'edit') {
          this.onMessage({ ...msg.data, type: 'edit' });
        } else if (msg.type === 'delete') {
          this.onMessage({ id: msg.data.id, type: 'delete' });
        } else if (msg.type === 'typing') {
          this.onMessage({ ...msg.data, type: 'typing' });
        } else if (msg.type === 'ack') {
          this.markAsSent(msg.id);
        } else if (msg.type === 'error') {
          console.error('Server reported error:', msg.message);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    this.ws.onclose = (event) => {
      this.isOnline = false;
      this.onStatusChange(false);
      
      if (!this.usePolling) {
        this.wsRetryCount++;
        // If it fails once on localhost, it's likely next dev is running instead of server.js
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        
        if (this.wsRetryCount > (isLocalhost ? 0 : this.maxWsRetries)) {
          console.warn(isLocalhost 
            ? 'WebSocket unavailable (are you using npm run dev?). Switching to polling mode.' 
            : 'WebSocket failed after multiple attempts. Falling back to polling.'
          );
          this.usePolling = true;
          this.startPolling();
        } else {
          const delay = Math.min(1000 * Math.pow(2, this.wsRetryCount), 10000);
          console.log(`WebSocket closed (code: ${event.code}). Reconnecting in ${delay}ms...`);
          setTimeout(() => this.connectWebSocket(), delay);
        }
      }
    };
    
    this.ws.onerror = (err) => {
      console.error('WebSocket connection failed.');
      this.ws.close();
    };
  }

  sendTyping(sender) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'typing', data: { sender } }));
    }
  }

  editMessage(id, content) {
    const data = { id, content };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'edit', data }));
    } else {
      fetch('/api/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    }
  }

  deleteMessage(id) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'delete', data: { id } }));
    } else {
      fetch('/api/messages', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
    }
  }

  // --- VERCEL MODE (API Polling) ---
  startPolling() {
    // Immediate first fetch
    this.fetchMessages();
    
    if (!this.pollInterval) {
      this.pollInterval = setInterval(() => {
        if (navigator.onLine) this.fetchMessages();
      }, 3000);
    }
  }

  async fetchMessages() {
    try {
      const res = await fetch('/api/messages');
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          json.data.forEach(m => this.onMessage(m));
        }
        if (!this.isOnline) {
          this.isOnline = true;
          this.onStatusChange(true);
          this.syncQueue();
        }
      } else {
        throw new Error(`Server returned ${res.status}`);
      }
    } catch (e) {
      if (this.isOnline) {
        console.error('Polling error:', e.message);
        this.isOnline = false;
        this.onStatusChange(false);
      }
    }
  }

  // --- CORE SEND LOGIC ---
  sendMessage(data) {
    const chatMsg = { ...data, status: 'pending' };
    
    // Optimistic UI update
    this.onMessage(chatMsg);
    
    if (!this.isOnline) {
      this.queueMessage(chatMsg);
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat', data: chatMsg }));
    } else {
      // Vercel / HTTP push
      this.pushViaAPI(chatMsg);
    }
  }

  async pushViaAPI(msg) {
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg)
      });
      if (res.ok) {
        this.markAsSent(msg.id);
      } else {
        this.queueMessage(msg);
      }
    } catch (e) {
      this.queueMessage(msg);
    }
  }

  // --- OFFLINE QUEUE (IndexedDB / LocalStorage) ---
  queueMessage(msg) {
    if (!this.queue.find(m => m.id === msg.id)) {
      this.queue.push(msg);
      this.saveQueueToDB();
    }
  }

  markAsSent(id) {
    this.queue = this.queue.filter(m => m.id !== id);
    this.saveQueueToDB();
  }

  async syncQueue() {
    if (this.queue.length === 0) return;
    const itemsToSync = [...this.queue];
    for (const msg of itemsToSync) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'chat', data: msg }));
      } else {
        await this.pushViaAPI(msg);
      }
    }
  }

  saveQueueToDB() {
    localStorage.setItem('chat_offline_queue', JSON.stringify(this.queue));
  }

  loadQueueFromDB() {
    const saved = localStorage.getItem('chat_offline_queue');
    if (saved) {
      this.queue = JSON.parse(saved);
      // Let UI know about pending messages
      this.queue.forEach(m => this.onMessage(m));
    }
  }
}
