import db from '@/lib/db';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) return Response.json({ data: null });

  try {
    const profile = db.prepare('SELECT id, username, color FROM profiles WHERE id = ?').get(id);
    return Response.json({ data: profile || null });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
