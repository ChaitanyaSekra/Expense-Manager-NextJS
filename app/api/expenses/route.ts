import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: Request) {
  const data = await req.json();
  const { user_id, type: entry_type = 'expense', description = '', date } = data;
  const category     = (data.category     || 'Uncategorized').trim();
  const payment_mode = (data.payment_mode === 'online') ? 'online' : 'cash';
  const today        = new Date().toISOString().slice(0, 10);

  if (!user_id || !data.amount)
    return NextResponse.json({ error: 'user_id and amount required' }, { status: 400 });
  if (!['expense', 'income'].includes(entry_type))
    return NextResponse.json({ error: 'type must be expense or income' }, { status: 400 });

  const amount = parseFloat(data.amount);
  if (isNaN(amount) || amount <= 0)
    return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });

  const expenseDate = date || today;

  // ── Write expense + atomically increment user totals in one batch ──────────
  const expenseRef = db.collection('expenses').doc();

  const isIncome = entry_type === 'income';
  const isCash   = payment_mode === 'cash';

  const totalsUpdate: Record<string, FieldValue> = {
    'totals.total_income':    isIncome ? FieldValue.increment(amount) : FieldValue.increment(0),
    'totals.total_expense':   isIncome ? FieldValue.increment(0)      : FieldValue.increment(amount),
    'totals.balance':         FieldValue.increment(isIncome ? amount : -amount),
    'totals.cash_income':     (isCash && isIncome)  ? FieldValue.increment(amount) : FieldValue.increment(0),
    'totals.cash_expense':    (isCash && !isIncome) ? FieldValue.increment(amount) : FieldValue.increment(0),
    'totals.cash_balance':    isCash ? FieldValue.increment(isIncome ? amount : -amount) : FieldValue.increment(0),
    'totals.online_income':   (!isCash && isIncome)  ? FieldValue.increment(amount) : FieldValue.increment(0),
    'totals.online_expense':  (!isCash && !isIncome) ? FieldValue.increment(amount) : FieldValue.increment(0),
    'totals.online_balance':  !isCash ? FieldValue.increment(isIncome ? amount : -amount) : FieldValue.increment(0),
  };

  const batch = db.batch();
  batch.set(expenseRef, {
    userId: user_id,
    amount,
    type: entry_type,
    category,
    description: description.trim(),
    date: expenseDate,
    payment_mode,
    createdAt: new Date().toISOString(),
  });
  batch.update(db.collection('users').doc(user_id), totalsUpdate);
  await batch.commit();

  return NextResponse.json({
    id: expenseRef.id, user_id, amount, type: entry_type,
    category, description, date: expenseDate, payment_mode,
  }, { status: 201 });
}