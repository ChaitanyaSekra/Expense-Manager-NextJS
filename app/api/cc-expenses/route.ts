import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: Request) {
  const data = await req.json();
  const { user_id, description = '', date } = data;
  const category = (data.category || 'Uncategorized').trim();
  const today    = new Date().toISOString().slice(0, 10);

  if (!user_id || !data.amount)
    return NextResponse.json({ error: 'user_id and amount required' }, { status: 400 });

  const amount = parseFloat(data.amount);
  if (isNaN(amount) || amount <= 0)
    return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });

  const expenseDate = date || today;

  const ref = db.collection('cc_expenses').doc();

  const batch = db.batch();
  batch.set(ref, {
    userId: user_id,
    amount,
    category,
    description: description.trim(),
    date: expenseDate,
    createdAt: new Date().toISOString(),
  });
  // Atomically increment cc totals on user doc
  batch.update(db.collection('users').doc(user_id), {
    'cc_totals.total_spent': FieldValue.increment(amount),
  });
  await batch.commit();

  return NextResponse.json(
    { id: ref.id, user_id, amount, category, description, date: expenseDate },
    { status: 201 }
  );
}