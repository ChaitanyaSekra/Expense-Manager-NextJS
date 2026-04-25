import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export async function POST(req: Request) {
  const { name: rawName, pin = null } = await req.json();
  const name = (rawName || '').trim();

  const snap = await db.collection('users')
    .where('name', '==', name).limit(1).get();

  if (snap.empty)
    return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const doc = snap.docs[0];
  const data = doc.data();

  if (data.pin && data.pin !== String(pin))
    return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 });

  return NextResponse.json({ id: doc.id, name: data.name });
}