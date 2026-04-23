# Chat Application — Architecture & Implementation Plan

## Table of Contents

1. [Overview](#overview)
2. [How It Works (Core Flow)](#how-it-works)
3. [Transport Layer — With and Without HTTPS](#transport-layer)
4. [Components](#components)
5. [Data Flow](#data-flow)
6. [Message Lifecycle](#message-lifecycle)
7. [Storage Design](#storage-design)
8. [Authentication & Identity](#authentication--identity)
9. [Offline & Push Notifications](#offline--push-notifications)
10. [Security Considerations](#security-considerations)
11. [Tech Stack Recommendations](#tech-stack-recommendations)
12. [Milestones](#milestones)

---

## Overview

A chat application is a real-time messaging system where users can exchange messages with near-zero latency. It consists of a client (mobile/web app), a server (handles routing and logic), a broker (delivers messages to the right recipients), and a database (persists history).

The system must work in two environments:

- **Standard (HTTPS/WSS)** — public internet with TLS encryption
- **Non-HTTPS (HTTP/WS)** — local networks, intranet, development, or air-gapped environments

---

## How It Works

At a high level, every message follows this path:

```
Sender → App Server → Message Broker → WebSocket Push → Receiver
                   ↘ Database (persist)
                   ↘ Push Notification (if receiver offline)
```

### Step-by-Step

1. **User types a message** and presses send.
2. The client sends the message payload to the app server over HTTP or WebSocket.
3. The app server **authenticates** the request using a session token or JWT.
4. The server **validates** the message (length, content, permissions).
5. The message is **saved to the database** with a timestamp and unique ID.
6. The server **publishes** the message to the message broker under the relevant channel (e.g., `room:abc123`).
7. The broker **pushes** the message to all connected clients subscribed to that channel via WebSocket.
8. If the receiver is **offline**, a push notification is sent via APNs (iOS) or FCM (Android).

---

## Transport Layer

### With HTTPS (Production)

| Protocol                | Purpose                               |
| ----------------------- | ------------------------------------- |
| `HTTPS` (HTTP + TLS)    | REST API calls — login, fetch history |
| `WSS` (WebSocket + TLS) | Real-time message delivery            |
| TLS 1.2 / 1.3           | Encrypts all data in transit          |

Everything is encrypted. Certificates are issued by a CA (e.g., Let's Encrypt).

### Without HTTPS (Local / Intranet / Development)

When TLS is unavailable or intentionally skipped (e.g., LAN chat, offline-first apps, embedded systems, dev environment):

| Protocol                     | Purpose                                              |
| ---------------------------- | ---------------------------------------------------- |
| `HTTP`                       | REST API calls over plain TCP                        |
| `WS` (WebSocket without TLS) | Real-time message delivery, unencrypted              |
| Raw TCP sockets              | Alternative to WebSocket for embedded/native clients |

#### Key Differences When Running Without HTTPS

- **No certificate required** — no domain, no CA, just an IP address and port.
- **WebSocket handshake** still works identically — the upgrade from HTTP → WS is protocol-level, not security-level.
- **Messages are transmitted in plaintext** — acceptable on trusted LANs, not on the public internet.
- **No mixed content blocking** — browsers block WSS calls from HTTPS pages, but plain WS from plain HTTP pages is allowed.
- **Authentication still applies** — tokens/sessions work identically over HTTP; they are just not encrypted in transit.

#### Example Non-HTTPS WebSocket Handshake

```
Client → Server:
GET /chat HTTP/1.1
Host: 192.168.1.10:8080
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13

Server → Client:
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

After this handshake, the connection is upgraded to a **persistent, full-duplex WebSocket**. Both sides can send frames at any time.

#### Running on a Local Network (No Domain, No TLS)

```
Server:  node server.js --host 0.0.0.0 --port 8080
Client:  const ws = new WebSocket("ws://192.168.1.10:8080/chat")
```

Any device on the same network can connect using the server's local IP. No certificates, no DNS required.

---

## Components

### 1. Client (Frontend)

- Renders the chat UI (message list, input box, user list)
- Maintains a WebSocket connection to the server
- Sends messages via the WebSocket or HTTP POST
- Handles reconnection on disconnect (exponential backoff)
- Displays delivery status: sent → delivered → read

### 2. App Server

- Entry point for all client requests
- Handles user authentication and session validation
- Accepts incoming messages and routes them
- Publishes messages to the broker
- Exposes REST endpoints for non-real-time operations (login, history, profile)

### 3. Message Broker

- Central hub for pub/sub messaging
- Clients subscribe to channels (one per room/conversation)
- When a message is published to a channel, all subscribers receive it instantly
- Decouples the sender from the receiver — the server doesn't need to know who is connected where
- Options: **Redis Pub/Sub**, **RabbitMQ**, **Kafka**, or **in-memory EventEmitter** (for single-server setups)

### 4. Database

- Persists all messages for history retrieval
- Stores user accounts, rooms, and membership
- Options: **PostgreSQL** (relational), **MongoDB** (document), **SQLite** (lightweight/embedded)

### 5. Auth Service

- Issues and validates tokens (JWT or session cookies)
- Can be embedded in the app server or run separately
- Handles registration, login, and logout

### 6. Push Notification Service (optional)

- Sends alerts when the receiver is offline
- Integrates with **APNs** (Apple) and **FCM** (Google/Android)
- Can be skipped for LAN/intranet-only apps

---

## Data Flow

```
┌─────────────┐    HTTP POST / WS frame    ┌─────────────────┐
│   Client A  │ ────────────────────────▶  │   App Server    │
│  (Sender)   │                            │                 │
└─────────────┘                            │  1. Auth check  │
                                           │  2. Validate    │
                                           │  3. Save to DB  │
                                           │  4. Publish     │
                                           └────────┬────────┘
                                                    │
                              ┌─────────────────────▼──────────────────────┐
                              │            Message Broker                   │
                              │   Channel: "room:xyz"                       │
                              │   Subscribers: [Client B, Client C, ...]    │
                              └────────────────────┬───────────────────────┘
                                                   │
                                     ┌─────────────▼─────────────┐
                                     │     WebSocket Push         │
                                     └─────────────┬─────────────┘
                                                   │
                              ┌────────────────────▼───────────────────────┐
                              │              Client B                       │
                              │         (Receiver — online)                 │
                              └────────────────────────────────────────────┘
```

---

## Message Lifecycle

Each message goes through the following states:

| State       | Meaning                                   |
| ----------- | ----------------------------------------- |
| `pending`   | Created on client, not yet sent to server |
| `sent`      | Server received and saved to DB           |
| `delivered` | Receiver's device received the WS frame   |
| `read`      | Receiver opened the message               |
| `failed`    | Delivery failed after retries             |

### Delivery Receipt Flow

1. Server saves message → replies with `{ id, status: "sent" }`
2. When receiver's WS client receives the message frame → client sends an **ack** frame back to server
3. Server updates status to `delivered` → notifies sender via WS
4. When receiver opens the conversation → client sends a **read receipt** event
5. Server updates status to `read` → notifies sender

---

## Storage Design

### Messages Table

```sql
CREATE TABLE messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES rooms(id),
  sender_id   UUID NOT NULL REFERENCES users(id),
  content     TEXT NOT NULL,
  status      VARCHAR(16) DEFAULT 'sent',
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Rooms Table

```sql
CREATE TABLE rooms (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(128),
  is_group   BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Users Table

```sql
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username     VARCHAR(64) UNIQUE NOT NULL,
  display_name VARCHAR(128),
  password_hash TEXT NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Indexing Strategy

```sql
CREATE INDEX idx_messages_room_created ON messages(room_id, created_at DESC);
CREATE INDEX idx_messages_sender       ON messages(sender_id);
```

Paginate history with cursor-based pagination:

```
GET /rooms/:id/messages?before=<message_id>&limit=50
```

---

## Authentication & Identity

### With HTTPS

- Use **JWT** (signed with HS256 or RS256) stored in `httpOnly` cookies or `Authorization` header.
- Tokens expire (e.g., 15 min access token + 7-day refresh token).
- WebSocket upgrade request includes the token in the query string or a handshake header.

### Without HTTPS

- Tokens still work, but are transmitted in plaintext — acceptable only on trusted networks.
- Alternatively use **session IDs** stored server-side (stateful, but simpler).
- For LAN apps, **username-only identity** (no password) is sometimes sufficient.

### WebSocket Auth Pattern

```js
// Client
const token = localStorage.getItem("token");
const ws = new WebSocket(`ws://192.168.1.10:8080/chat?token=${token}`);

// Server
wss.on("connection", (ws, req) => {
  const token = new URL(req.url, "http://x").searchParams.get("token");
  const user = verifyToken(token); // throws if invalid
  if (!user) return ws.close(4001, "Unauthorized");
  ws.userId = user.id;
});
```

---

## Offline & Push Notifications

When a user is not connected via WebSocket:

1. The broker detects no active subscriber for that user.
2. The app server flags the message as `pending_push`.
3. A background worker sends a push notification payload to FCM/APNs.
4. When the user opens the app, the client fetches unread messages from the REST API.

For non-HTTPS / LAN apps without FCM/APNs:

- Use **long polling** as a fallback: client polls `GET /messages/unread` every 5–10 seconds when WS is unavailable.
- Or use **Server-Sent Events (SSE)** — one-way push over plain HTTP, no WS required.

---

## Security Considerations

| Risk                          | Mitigation                                              |
| ----------------------------- | ------------------------------------------------------- |
| Message interception (no TLS) | Acceptable only on trusted LANs; add TLS for production |
| Token theft                   | Short expiry + refresh tokens; httpOnly cookies         |
| Message tampering             | Sign messages with HMAC on server before saving         |
| Spam / flooding               | Rate limiting per user (e.g., max 10 msg/sec)           |
| XSS in message content        | Sanitize and escape all rendered message text           |
| Unauthorized room access      | Validate room membership on every message and WS join   |
| Replay attacks                | Include a nonce or timestamp in each message frame      |

---

## Tech Stack Recommendations

### Minimal (Single Server, No HTTPS Needed)

| Layer    | Choice                     |
| -------- | -------------------------- |
| Server   | Node.js + `ws` library     |
| Broker   | In-process `EventEmitter`  |
| Database | SQLite (`better-sqlite3`)  |
| Auth     | JWT (`jsonwebtoken`)       |
| Client   | Vanilla JS + WebSocket API |

### Production (Multi-Server, HTTPS)

| Layer    | Choice                                |
| -------- | ------------------------------------- |
| Server   | Node.js + Express, or Go + Gorilla WS |
| Broker   | Redis Pub/Sub                         |
| Database | PostgreSQL                            |
| Auth     | JWT + refresh tokens                  |
| Client   | React / Vue                           |
| Push     | FCM + APNs via Firebase Admin SDK     |
| TLS      | Let's Encrypt (Certbot)               |

---

## Milestones

### Phase 1 — Core (No HTTPS, Local Only)

- [ ] WebSocket server accepting connections on plain `ws://`
- [ ] In-memory pub/sub for message routing
- [ ] SQLite persistence for message history
- [ ] Simple username-based identity (no password)
- [ ] Basic HTML/JS client connecting via `ws://`

### Phase 2 — Multi-Room & Identity

- [ ] Room creation and membership
- [ ] JWT-based authentication
- [ ] REST API for history (`GET /rooms/:id/messages`)
- [ ] Delivery acknowledgement (sent → delivered)

### Phase 3 — Production Hardening

- [ ] TLS (upgrade `ws://` → `wss://`, `http://` → `https://`)
- [ ] Redis Pub/Sub (replace in-memory broker)
- [ ] PostgreSQL (replace SQLite)
- [ ] Rate limiting
- [ ] Push notifications (FCM / APNs)
- [ ] Read receipts and typing indicators

### Phase 4 — Scale

- [ ] Horizontal scaling (multiple app server instances)
- [ ] Sticky sessions or Redis session store
- [ ] Media/file attachments (S3 or local storage)
- [ ] End-to-end encryption (E2EE) with client-side key management

---

_This plan covers both HTTPS and non-HTTPS environments. For local/LAN deployments, Phase 1 alone is sufficient to have a working chat system without any certificates or domain name._
