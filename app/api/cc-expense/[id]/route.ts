import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = await req.json();
  const { amount, category, description, date } = data;

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const newAmount = parseFloat(amount);
  if (isNaN(newAmount) || newAmount <= 0)
    return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });

  const ref = db.collection('cc_expenses').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const old = snap.data()!;
  const delta = newAmount - old.amount;

  const batch = db.batch();
  batch.update(ref, {
    amount: newAmount,
    category: (category || 'Uncategorized').trim(),
    description: (description || '').trim(),
    date: date || old.date,
  });
  if (delta !== 0) {
    batch.update(db.collection('users').doc(old.userId), {
      'cc_totals.total_spent': FieldValue.increment(delta),
    });
  }
  await batch.commit();

  return NextResponse.json({ id, ...old, amount: newAmount, category, description, date });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const ref = db.collection('cc_expenses').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const old = snap.data()!;

  const batch = db.batch();
  batch.delete(ref);
  batch.update(db.collection('users').doc(old.userId), {
    'cc_totals.total_spent': FieldValue.increment(-old.amount),
  });
  await batch.commit();

  return NextResponse.json({ deleted: id });
}