import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');
  const contactId = searchParams.get('contact_id');

  if (!userId) return NextResponse.json({ data: [] });

  try {
    let query = supabase.from('messages').select('*');
    
    if (contactId) {
      // Fetch private conversation
      query = query.or(`and(sender_id.eq.${userId},receiver_id.eq.${contactId}),and(sender_id.eq.${contactId},receiver_id.eq.${userId})`);
    } else {
      // Fetch all messages involving the user (for notification/sync)
      query = query.or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
    }

    const { data, error } = await query.order('timestamp', { ascending: true }).limit(100);
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Supabase fetch error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const msg = {
      id: body.id || crypto.randomUUID(),
      sender: body.sender,
      sender_id: body.sender_id,
      receiver_id: body.receiver_id,
      color: body.color,
      content: body.content,
      timestamp: body.timestamp || Date.now(),
      is_read: false
    };

    const { error } = await supabase.from('messages').insert([msg]);
    if (error) throw error;

    return NextResponse.json({ success: true, data: msg });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
