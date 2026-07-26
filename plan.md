# Task: Implement Hybrid Local/Cloud Sync for LocalChat

## Phase 1: ChatClient Integration ✅
- [x] Import and initialize `ChatClient` in `src/app/page.js`
- [x] Connect `ChatClient` to the existing `messages` state
- [x] Ensure `ChatClient` uses the correct server URL (Local IP on Android, relative on Web)

## Phase 2: Dual-Mode Messaging ✅
- [x] Modify `handleSend` to send via BOTH `ChatClient` (Local) and Firestore (Cloud)
- [x] Handle message deduplication in the UI
- [x] Update `handleFileUpload` to be more robust across platforms

## Phase 3: Offline Persistence ✅
- [x] Synchronize Firestore messages to SQLite via API routes (Basic implementation)
- [x] Load initial state from SQLite if Firebase is slow/offline (Handled via ChatClient)

## Phase 4: UI Refinement ✅
- [x] Fixed image upload URLs for Android compatibility
- [x] Added group chat support to WebSocket server
- [x] Verified all API routes and Database schema

## Phase 5: Codebase Hardening ✅
- [x] **Security**: Fixed path traversal vulnerability in custom API resolver (`server.js`).
- [x] **Security**: Prevented identity spoofing in WebSockets by enforcing `currentUserId` from auth context.
- [x] **Stability**: Added `ws.on('close')` handler to prevent memory leaks in the client Map.
- [x] **Privacy**: Restored group broadcast privacy by verifying membership before sending.
- [x] **Performance**: Added SQLite indexes on `messages` and `group_members` tables.
- [x] **Integrity**: Added basic requester verification to the Messages API route.
