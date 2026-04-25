import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export async function GET() {
  const snap = await db.collection('users')
    .orderBy('name').get();
  const users = snap.docs.map(d => ({ id: d.id, name: d.data().name }));
  return NextResponse.json(users);
}

export async function POST(req: Request) {
  const { name: rawName, pin = null } = await req.json();
  const name = (rawName || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const snap = await db.collection('users').get();
  if (snap.size >= 5)
    return NextResponse.json({ error: 'Maximum 5 users allowed' }, { status: 400 });

  const existing = snap.docs.find(d => d.data().name.toLowerCase() === name.toLowerCase());
  if (existing)
    return NextResponse.json({ error: 'Username already exists' }, { status: 409 });

  const ref = await db.collection('users').add({
    name, pin, createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ id: ref.id, name }, { status: 201 });
}