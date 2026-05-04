import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const doc = await db.collection('users').doc(userId).get();
  if (!doc.exists) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const data = doc.data()!;
  return NextResponse.json({ id: doc.id, name: data.name });
}