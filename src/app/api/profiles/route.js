import db from '@/lib/db';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('query');
  const excludeId = searchParams.get('excludeId');

  if (!query) return Response.json({ data: [] });

  try {
    // Basic search on username or email
    const search = `%${query}%`;
    const profiles = db.prepare(
      'SELECT id, username, color FROM profiles WHERE (username LIKE ? OR email LIKE ?) AND id != ? LIMIT 5'
    ).all(search, search, excludeId || '');

    return Response.json({ data: profiles });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}