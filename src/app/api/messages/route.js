import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';

// Fallback in-memory store for local development without Supabase
let globalMessages = [];

export async function GET(request) {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(100);

    if (error) throw error;
    return NextResponse.json({ data: data.reverse() });
  } catch (error) {
    console.error('Supabase fetch error:', error.message);
    return NextResponse.json({ data: globalMessages });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    
    const msg = {
      id: body.id || crypto.randomUUID(),
      sender: body.sender || 'Anonymous',
      color: body.color || '#3b82f6',
      content: body.content,
      timestamp: body.timestamp || Date.now()
    };

    // Try Supabase first
    const { error } = await supabase.from('messages').insert([msg]);
    
    if (error) {
      console.warn('Supabase insert failed, falling back to memory:', error.message);
      globalMessages.push(msg);
      if (globalMessages.length > 100) globalMessages = globalMessages.slice(-100);
    }

    return NextResponse.json({ success: true, data: msg });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save message' }, { status: 500 });
  }
}
