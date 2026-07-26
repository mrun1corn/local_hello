import db from '@/lib/db';
import { verifyIdToken } from '@/lib/firebase-admin';

export async function GET(req) {
  const user = await verifyIdToken(req);
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const query = searchParams.get('query');

  try {
    if (id) {
      const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
      return Response.json(profile || { error: 'Not found' }, { status: profile ? 200 : 404 });
    }

    if (query) {
      const profiles = db.prepare(`
        SELECT * FROM profiles 
        WHERE username LIKE ? 
        LIMIT 20
      `).all(`%${query}%`);
      return Response.json({ data: profiles });
    }

    return Response.json({ error: 'Missing parameters' }, { status: 400 });
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
    const { id, username, color } = await req.json();
    
    // Security: Users can only update their own profile
    if (id !== user.uid) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    // UPSERT pattern
    const insert = db.prepare(`
      INSERT INTO profiles (id, username, color, last_seen)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        color = excluded.color,
        last_seen = excluded.last_seen
    `);
    
    insert.run(id, username, color, Date.now());
    
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
