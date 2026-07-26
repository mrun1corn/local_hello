import db from '@/lib/db';
import { verifyIdToken } from '@/lib/firebase-admin';

export async function GET(req) {
  const user = await verifyIdToken(req);
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const groups = db.prepare(`
      SELECT g.* FROM groups g
      JOIN group_members gm ON g.id = gm.group_id
      WHERE gm.user_id = ?
    `).all(user.uid);

    // Enforce consistency: SQLite integers back to booleans
    const mapped = groups.map(g => ({
        ...g,
        isGroup: !!g.isGroup
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
    const { name, members, color } = await req.json();
    const id = 'group_' + Date.now();
    const username = name; // UI compatibility

    const insertGroup = db.prepare('INSERT INTO groups (id, name, username, color, created_at, isGroup) VALUES (?, ?, ?, ?, ?, 1)');
    const insertMember = db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)');

    // Use a transaction for atomic group creation
    const createGroupTx = db.transaction((groupId, groupName, groupMembers, groupColor) => {
      insertGroup.run(groupId, groupName, groupName, groupColor, Date.now());
      for (const userId of groupMembers) {
        insertMember.run(groupId, userId);
      }
    });

    createGroupTx(id, name, members, color);

    return Response.json({ success: true, id });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
