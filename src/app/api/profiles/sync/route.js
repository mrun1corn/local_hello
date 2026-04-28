import db from '@/lib/db';

export async function POST(req) {
  try {
    const { id, email, username } = await req.json();

    // Check if profile exists
    const existing = db.prepare('SELECT id FROM profiles WHERE id = ?').get(id);

    if (existing) {
      // Update existing
      db.prepare('UPDATE profiles SET email = ?, username = ? WHERE id = ?')
        .run(email, username, id);
    } else {
      // Create new
      // We don't need password_hash anymore since Firebase handles it, 
      // but let's keep the column in DB for compatibility or set to empty
      const color = '#' + Math.floor(Math.random() * 16777215).toString(16);
      db.prepare('INSERT INTO profiles (id, username, email, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, username, email, 'firebase_auth', color, Date.now());
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error('Sync Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}