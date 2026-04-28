import db from '@/lib/db';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const userId1 = searchParams.get('userId1');
  const userId2 = searchParams.get('userId2');

  if (!userId1 || !userId2) {
    return Response.json({ error: 'Missing user IDs' }, { status: 400 });
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
  try {
    const msg = await req.json();
    const insert = db.prepare('INSERT INTO messages (id, sender, sender_id, receiver_id, color, content, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insert.run(msg.id, msg.sender, msg.sender_id, msg.receiver_id, msg.color, msg.content, msg.timestamp || Date.now());
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}