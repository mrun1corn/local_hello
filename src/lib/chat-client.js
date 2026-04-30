export class ChatClient {
  constructor(user_id, onMessage, onStatusChange) {
    this.user_id = user_id;
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
    const isLocal = typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    if (isLocal) this.connectWebSocket();
    else { this.usePolling = true; this.startPolling(); }
    window.addEventListener('online', () => this.syncQueue());
  }

  connectWebSocket() {
    if (this.usePolling) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.isOnline = true;
      this.wsRetryCount = 0;
      this.onStatusChange(true);
      this.ws.send(JSON.stringify({ type: 'auth', data: { id: this.user_id } }));
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
      } catch (e) { console.error(e); }
    };

    this.ws.onclose = () => {
      this.isOnline = false;
      this.onStatusChange(false);
      if (!this.usePolling) {
        this.wsRetryCount++;
        setTimeout(() => this.connectWebSocket(), 2000);
      }
    };
    this.ws.onerror = () => this.ws.close();
  }

  sendTyping(sender, receiver_id) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'typing', data: { sender, receiver_id } }));
  }

  markRead(id, receiver_id) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'read', data: { id, receiver_id } }));
    else fetch('/api/messages', { method: 'PATCH', body: JSON.stringify({ id, is_read: true }) });
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
    if (!this.pollInterval) this.pollInterval = setInterval(() => { if (navigator.onLine) this.fetchMessages(); }, 3000);
  }

  async fetchMessages() {
    try {
      const res = await fetch(`/api/messages?user_id=${this.user_id}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) json.data.forEach(m => this.onMessage(m));
        if (!this.isOnline) { 
          this.isOnline = true; 
          this.onStatusChange(true); 
          this.syncQueue(); 
        }
      } else {
        throw new Error('Fetch failed');
      }
    } catch (e) { 
      if (this.isOnline) {
        this.isOnline = false; 
        this.onStatusChange(false); 
      }
    }
  }

  sendMessage(data) {
    const chatMsg = { ...data, status: 'pending' };
    this.onMessage(chatMsg);
    if (!this.isOnline) { this.queueMessage(chatMsg); return; }
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'chat', data: chatMsg }));
    else this.pushViaAPI(chatMsg);
  }

  async pushViaAPI(msg) {
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'chat', data: msg })); else await this.pushViaAPI(msg);
    }
  }
  saveQueueToDB() { localStorage.setItem('chat_offline_queue_' + this.user_id, JSON.stringify(this.queue)); }
  loadQueueFromDB() {
    const saved = localStorage.getItem('chat_offline_queue_' + this.user_id);
    if (saved) { this.queue = JSON.parse(saved); this.queue.forEach(m => this.onMessage(m)); }
  }
}
