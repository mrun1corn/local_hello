const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const PORT = 3001; // Use a different port for testing
const BASE_URL = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}`;

async function runTests() {
  console.log('🚀 Starting Hardening Tests...');
  
  // 1. Start the server
  const serverProcess = spawn('node', ['server.js'], {
    env: { ...process.env, PORT, NODE_ENV: 'test' },
    stdio: 'pipe'
  });

  serverProcess.stdout.on('data', (data) => {
     console.log(`[SERVER] ${data}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[SERVER ERROR] ${data}`);
  });

  // Wait for server to be ready
  await new Promise(resolve => setTimeout(resolve, 3000));

  try {
    // --- TEST 1: Path Traversal ---
    console.log('\n🔍 Testing Path Traversal Prevention...');
    const traversalPaths = [
      '/api/../../server.js',
      '/api/%2e%2e/%2e%2e/server.js',
      '/api/..\\..\\server.js'
    ];

    for (const p of traversalPaths) {
      const res = await fetchResponse(`${BASE_URL}${p}`);
      if (res.statusCode === 403 || res.statusCode === 404) {
        console.log(`✅ Path ${p} blocked correctly (Status: ${res.statusCode})`);
      } else {
        throw new Error(`❌ Path ${p} NOT blocked! (Status: ${res.statusCode})`);
      }
    }

    // --- TEST 2: WebSocket Identity Enforcement ---
    console.log('\n🔍 Testing WebSocket Identity Enforcement...');
    const ws1 = new WebSocket(WS_URL);
    ws1.on('error', (err) => console.log('Client ws1 error:', err.message));
    ws1.on('close', (code, reason) => console.log('Client ws1 closed:', code, reason.toString()));
    await new Promise(resolve => ws1.on('open', resolve));
    
    // Auth as user_a
    ws1.send(JSON.stringify({ type: 'auth', data: { id: 'user_a' } }));
    await new Promise(resolve => setTimeout(resolve, 500));

    // Try to send a message claiming to be user_b (spoofing)
    // The server should now ignore the sender_id in the message and use the authenticated currentUserId
    const msgId = 'test_msg_' + Date.now();
    ws1.send(JSON.stringify({
      type: 'chat',
      data: {
        id: msgId,
        sender: 'SpoofedUser',
        sender_id: 'user_b', // Spoof attempt
        receiver_id: 'user_c',
        content: 'Hello from a spoofed identity',
        timestamp: Date.now()
      }
    }));

    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify in DB that the message was saved with sender_id='user_a'
    const Database = require('better-sqlite3');
    const db = new Database(path.join(process.cwd(), 'data', 'chat.db'));
    const savedMsg = db.prepare('SELECT sender_id FROM messages WHERE id = ?').get(msgId);
    
    if (savedMsg && savedMsg.sender_id === 'user_a') {
      console.log('✅ WebSocket identity spoofing prevented (Stored sender_id: user_a)');
    } else {
      throw new Error(`❌ WebSocket identity spoofing FAILED! (Stored sender_id: ${savedMsg?.sender_id})`);
    }
    ws1.close();

    // --- TEST 3: Group Broadcast Privacy ---
    console.log('\n🔍 Testing Group Broadcast Privacy...');
    
    // Setup: Create a group and add user_a and user_b. user_c is NOT a member.
    const groupId = 'test_group_' + Date.now();
    db.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run(groupId, 'Secret Group');
    db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, 'user_a');
    db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, 'user_b');

    const ws_a = new WebSocket(WS_URL);
    const ws_c = new WebSocket(WS_URL);
    
    await Promise.all([
      new Promise(resolve => ws_a.on('open', resolve)),
      new Promise(resolve => ws_c.on('open', resolve))
    ]);

    ws_a.send(JSON.stringify({ type: 'auth', data: { id: 'user_a' } }));
    ws_c.send(JSON.stringify({ type: 'auth', data: { id: 'user_c' } }));
    await new Promise(resolve => setTimeout(resolve, 500));

    let userCReceived = false;
    ws_c.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'chat' && msg.data.receiver_id === groupId) {
        userCReceived = true;
      }
    });

    // user_a sends to group
    ws_a.send(JSON.stringify({
      type: 'chat',
      data: {
        id: 'group_msg_' + Date.now(),
        sender: 'UserA',
        receiver_id: groupId,
        isGroup: true,
        content: 'Secret group message',
        timestamp: Date.now()
      }
    }));

    await new Promise(resolve => setTimeout(resolve, 1000));

    if (!userCReceived) {
      console.log('✅ Group broadcast privacy verified (User C did not receive message)');
    } else {
      throw new Error('❌ Group broadcast privacy FAILED! User C received secret group message');
    }

    ws_a.close();
    ws_c.close();

    console.log('\n✨ ALL HARDENING TESTS PASSED! ✨');

  } catch (err) {
    console.error(`\n💥 TEST FAILED: ${err.message}`);
    process.exit(1);
  } finally {
    serverProcess.kill();
  }
}

function fetchResponse(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      resolve({ statusCode: res.statusCode });
    }).on('error', (e) => {
      resolve({ statusCode: 500, error: e });
    });
  });
}

runTests();
