import db from '@/lib/db';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) return Response.json({ error: 'Missing userId' }, { status: 400 });

  try {
    const blocks = db.prepare(`
      SELECT b.blocked_id, p.id, p.username, p.color
      FROM blocks b
      JOIN profiles p ON b.blocked_id = p.id
      WHERE b.blocker_id = ?
    `).all(userId);

    const mapped = blocks.map(b => ({
      blocked_id: b.blocked_id,
      blocked: { id: b.id, username: b.username, color: b.color }
    }));

    return Response.json({ data: mapped });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}