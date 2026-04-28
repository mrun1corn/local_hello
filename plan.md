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
