import db from '@/lib/db';
import { verifyIdToken } from '@/lib/firebase-admin';

export async function GET(req) {
  const user = await verifyIdToken(req);
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const userId1 = searchParams.get('userId1');
  const userId2 = searchParams.get('userId2');
  const pollingUserId = searchParams.get('user_id');

  // Polling mode: if user_id is present, return all messages for that user
  if (pollingUserId) {
    if (user.uid !== pollingUserId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      const messages = db.prepare(`
        SELECT * FROM messages 
        WHERE sender_id = ? OR receiver_id = ?
        ORDER BY timestamp ASC
      `).all(pollingUserId, pollingUserId);
      return Response.json({ data: messages });
    } catch (err) {
      return Response.json({ error: err.message }, { status: 500 });
    }
  }

  if (!userId1 || !userId2) {
    return Response.json({ error: 'Missing parameters' }, { status: 400 });
  }

  // Security: Only allow users involved in the conversation to fetch history
  if (user.uid !== userId1 && user.uid !== userId2) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const messages = db.prepare(`
      SELECT * FROM messages 
      WHERE (sender_id = ? AND receiver_id = ?) 
         OR (sender_id = ? AND receiver_id = ?)
      ORDER BY timestamp ASC
    `).all(userId1, userId2, userId2, userId1);

    return Response.json({ data: messages });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const user = await verifyIdToken(req);
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const msg = await req.json();
    const insert = db.prepare('INSERT INTO messages (id, sender, sender_id, receiver_id, color, content, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)');
    // Security: Use authenticated user.uid as sender_id
    insert.run(msg.id, msg.sender, user.uid, msg.receiver_id, msg.color, msg.content, msg.timestamp || Date.now());
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}