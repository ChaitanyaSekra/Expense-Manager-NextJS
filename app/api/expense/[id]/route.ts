import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = await req.json();
  const updates: Record<string, unknown> = {};

  if ('amount' in data) {
    const amt = parseFloat(data.amount);
    if (isNaN(amt) || amt <= 0)
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
    updates.amount = amt;
  }
  if ('type' in data) {
    if (!['expense', 'income'].includes(data.type))
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    updates.type = data.type;
  }
  if ('category' in data)     updates.category     = (data.category || 'Uncategorized').trim();
  if ('description' in data)  updates.description  = (data.description || '').trim();
  if ('date' in data)         updates.date         = data.date;
  if ('payment_mode' in data) updates.payment_mode = (data.payment_mode === 'online') ? 'online' : 'cash';

  if (!Object.keys(updates).length)
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  await db.collection('expenses').doc(id).update(updates);
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await db.collection('expenses').doc(id).delete();
  return NextResponse.json({ success: true });
}
