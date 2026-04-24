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
      query = query.or(`and(sender_id.eq.${userId},receiver_id.eq.${contactId}),and(sender_id.eq.${contactId},receiver_id.eq.${userId})`);
    } else {
      query = query.or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
    }

    const { data, error } = await query.order('timestamp', { ascending: true }).limit(100);
    if (error) throw error;
    return NextResponse.json({ data: data || [] });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.content || !body.sender_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const msg = {
      id: body.id || crypto.randomUUID(),
      sender: body.sender || 'User',
      sender_id: body.sender_id,
      receiver_id: body.receiver_id || null,
      color: body.color || '#3b82f6',
      content: body.content,
      timestamp: body.timestamp || Date.now(),
      is_read: false
    };

    const { error } = await supabase.from('messages').insert([msg]);
    if (error) throw error;

    return NextResponse.json({ success: true, data: msg });
  } catch (error) {
    console.error('API POST Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    const { error } = await supabase
      .from('messages')
      .update({ is_read: body.is_read ?? true })
      .eq('id', body.id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
