import db from '@/lib/db';
import { verifyIdToken } from '@/lib/firebase-admin';

export async function GET(req) {
  const user = await verifyIdToken(req);
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const connections = db.prepare(`
      SELECT 
        c.*, 
        sp.username as sender_username, sp.color as sender_color,
        rp.username as receiver_username, rp.color as receiver_color
      FROM connections c
      LEFT JOIN profiles sp ON c.sender_id = sp.id
      LEFT JOIN profiles rp ON c.receiver_id = rp.id
      WHERE c.sender_id = ? OR c.receiver_id = ?
    `).all(user.uid, user.uid);

    // Map to the shape expected by frontend (senderProfile, receiverProfile)
    const mapped = connections.map(c => ({
      ...c,
      senderProfile: { id: c.sender_id, username: c.sender_username, color: c.sender_color },
      receiverProfile: { id: c.receiver_id, username: c.receiver_username, color: c.receiver_color }
    }));

    return Response.json({ data: mapped });
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
    const { receiver_id, status } = await req.json();
    const id = crypto.randomUUID();
    const insert = db.prepare('INSERT INTO connections (id, sender_id, receiver_id, status, timestamp) VALUES (?, ?, ?, ?, ?)');
    insert.run(id, user.uid, receiver_id, status || 'pending', Date.now());
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req) {
  const user = await verifyIdToken(req);
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id, status } = await req.json();
    const update = db.prepare('UPDATE connections SET status = ? WHERE id = ?');
    update.run(status, id);
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}