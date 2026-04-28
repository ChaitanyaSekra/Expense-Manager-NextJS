import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export async function POST(req: Request) {
  const data = await req.json();
  const { user_id, type: entry_type = 'expense', description = '', date } = data;
  const category     = (data.category     || 'Uncategorized').trim();
  const payment_mode = (data.payment_mode === 'online') ? 'online' : 'cash'; // default: cash
  const today = new Date().toISOString().slice(0, 10);

  if (!user_id || !data.amount)
    return NextResponse.json({ error: 'user_id and amount required' }, { status: 400 });
  if (!['expense', 'income'].includes(entry_type))
    return NextResponse.json({ error: 'type must be expense or income' }, { status: 400 });

  const amount = parseFloat(data.amount);
  if (isNaN(amount) || amount <= 0)
    return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });

  const ref = await db.collection('expenses').add({
    userId: user_id,
    amount,
    type: entry_type,
    category,
    description: description.trim(),
    date: date || today,
    payment_mode,
    createdAt: new Date().toISOString(),
  });

  return NextResponse.json({
    id: ref.id, user_id, amount, type: entry_type,
    category, description, date: date || today, payment_mode,
  }, { status: 201 });
}
