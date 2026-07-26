import db from '@/lib/db';
import { verifyIdToken } from '@/lib/firebase-admin';

export async function GET(req) {
  const user = await verifyIdToken(req);
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const blocks = db.prepare(`
      SELECT b.blocked_id, p.id, p.username, p.color
      FROM blocks b
      JOIN profiles p ON b.blocked_id = p.id
      WHERE b.blocker_id = ?
    `).all(user.uid);

    const mapped = blocks.map(b => ({
      blocked_id: b.blocked_id,
      blocked: { id: b.id, username: b.username, color: b.color }
    }));

    return Response.json({ data: mapped });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}