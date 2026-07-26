export class ChatClient {
  constructor(user_id, token, onMessage, onStatusChange) {
    this.user_id = user_id;
    this.token = token;
    this.onMessage = onMessage;
    this.onStatusChange = onStatusChange;
    this.ws = null;
    this.isOnline = false;
    this.pollInterval = null;
    this.queue = [];
    this.wsRetryCount = 0;
    this.maxWsRetries = 10;
    this.init();
  }

  async init() {
    this.loadQueueFromDB();
    this.connectWebSocket();
    window.addEventListener('online', () => this.syncQueue());
  }

  setToken(token) {
    this.token = token;
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'auth', token: this.token }));
    }
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.isOnline = true;
      this.wsRetryCount = 0;
      this.onStatusChange(true);
      if (this.token) {
        this.ws.send(JSON.stringify({ type: 'auth', token: this.token }));
      }
      this.syncQueue();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'history') msg.data.forEach(m => this.onMessage(m));
        else if (msg.type === 'chat') this.onMessage(msg.data);
        else if (msg.type === 'edit') this.onMessage({ ...msg.data, type: 'edit' });
        else if (msg.type === 'delete') this.onMessage({ id: msg.data.id, type: 'delete' });
        else if (msg.type === 'typing') this.onMessage({ ...msg.data, type: 'typing' });
        else if (msg.type === 'read') this.onMessage({ id: msg.data.id, type: 'read' });
        else if (msg.type === 'ack') this.markAsSent(msg.id);
        else if (msg.type === 'verified') console.log('[WS] Verified');
      } catch (e) { console.error(e); }
    };

    this.ws.onclose = () => {
      this.isOnline = false;
      this.onStatusChange(false);
      this.wsRetryCount++;
      // Exponential backoff
      const delay = Math.min(1000 * Math.pow(2, this.wsRetryCount), 30000);
      setTimeout(() => this.connectWebSocket(), delay);
    };
    this.ws.onerror = () => this.ws.close();
  }

  sendTyping(sender, receiver_id) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'typing', data: { sender, receiver_id } }));
  }

  async markRead(id, receiver_id) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'read', data: { id, receiver_id } }));
    } else {
      await fetch('/api/messages', { 
        method: 'PATCH', 
        headers: { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_read: true }) 
      });
    }
  }

  blockUser(blocked_id) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'block', data: { blocked_id } }));
  }

  editMessage(id, receiver_id, content) {
    const data = { id, receiver_id, content };
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'edit', data }));
  }

  deleteMessage(id, receiver_id) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'delete', data: { id, receiver_id } }));
  }

  startPolling() {
    this.fetchMessages();
    if (!this.pollInterval) this.pollInterval = setInterval(() => { if (navigator.onLine) this.fetchMessages(); }, 5000);
  }

  async fetchMessages() {
    if (!this.token) return;
    try {
      const res = await fetch(`/api/messages?user_id=${this.user_id}`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data) json.data.forEach(m => this.onMessage(m));
        if (!this.isOnline) { 
          this.isOnline = true; 
          this.onStatusChange(true); 
          this.syncQueue(); 
        }
      }
    } catch (e) { 
      // Silently fail polling
    }
  }

  sendMessage(data) {
    this.onMessage({ ...data, status: 'pending' });
    
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'chat', data }));
    } else {
      this.pushViaAPI(data);
    }
  }

  async pushViaAPI(msg) {
    if (!this.token) { this.queueMessage(msg); return; }
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify(msg)
      });
      if (res.ok) this.markAsSent(msg.id); else this.queueMessage(msg);
    } catch (e) { this.queueMessage(msg); }
  }

  queueMessage(msg) { if (!this.queue.find(m => m.id === msg.id)) { this.queue.push(msg); this.saveQueueToDB(); } }
  markAsSent(id) { this.queue = this.queue.filter(m => m.id !== id); this.saveQueueToDB(); }
  async syncQueue() {
    if (this.queue.length === 0) return;
    for (const msg of [...this.queue]) {
      if (this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'chat', data: msg }));
      } else {
        await this.pushViaAPI(msg);
      }
    }
  }
  saveQueueToDB() { localStorage.setItem('chat_offline_queue_' + this.user_id, JSON.stringify(this.queue)); }
  loadQueueFromDB() {
    const saved = localStorage.getItem('chat_offline_queue_' + this.user_id);
    if (saved) { this.queue = JSON.parse(saved); this.queue.forEach(m => this.onMessage(m)); }
  }
}
