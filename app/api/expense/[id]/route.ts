import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = await req.json();

  // ── Fetch the old expense so we can reverse its contribution to totals ─────
  const oldSnap = await db.collection('expenses').doc(id).get();
  if (!oldSnap.exists)
    return NextResponse.json({ error: 'Expense not found' }, { status: 404 });
  const old = oldSnap.data()!;

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

  // ── Compute totals delta: reverse old, apply new ───────────────────────────
  const newAmount      = (updates.amount      as number)  ?? old.amount;
  const newType        = (updates.type        as string)  ?? old.type;
  const newPaymentMode = (updates.payment_mode as string) ?? old.payment_mode ?? 'cash';

  const oldIsIncome = old.type === 'income';
  const oldIsCash   = (old.payment_mode ?? 'cash') === 'cash';
  const newIsIncome = newType === 'income';
  const newIsCash   = newPaymentMode === 'cash';

  // Delta = (new contribution) - (old contribution) for each total
  const dTotalIncome  = (newIsIncome  ? newAmount : 0) - (oldIsIncome  ? old.amount : 0);
  const dTotalExpense = (!newIsIncome ? newAmount : 0) - (!oldIsIncome ? old.amount : 0);
  const dBalance      = (newIsIncome  ? newAmount : -newAmount) - (oldIsIncome ? old.amount : -old.amount);

  const dCashIncome    = (newIsCash  && newIsIncome  ? newAmount : 0) - (oldIsCash && oldIsIncome  ? old.amount : 0);
  const dCashExpense   = (newIsCash  && !newIsIncome ? newAmount : 0) - (oldIsCash && !oldIsIncome ? old.amount : 0);
  const dCashBalance   = (newIsCash  ? (newIsIncome  ? newAmount : -newAmount) : 0)
                       - (oldIsCash  ? (oldIsIncome  ? old.amount : -old.amount) : 0);

  const dOnlineIncome  = (!newIsCash && newIsIncome  ? newAmount : 0) - (!oldIsCash && oldIsIncome  ? old.amount : 0);
  const dOnlineExpense = (!newIsCash && !newIsIncome ? newAmount : 0) - (!oldIsCash && !oldIsIncome ? old.amount : 0);
  const dOnlineBalance = (!newIsCash ? (newIsIncome  ? newAmount : -newAmount) : 0)
                       - (!oldIsCash ? (oldIsIncome  ? old.amount : -old.amount) : 0);

  const batch = db.batch();
  batch.update(db.collection('expenses').doc(id), updates);
  batch.update(db.collection('users').doc(old.userId), {
    'totals.total_income':   FieldValue.increment(dTotalIncome),
    'totals.total_expense':  FieldValue.increment(dTotalExpense),
    'totals.balance':        FieldValue.increment(dBalance),
    'totals.cash_income':    FieldValue.increment(dCashIncome),
    'totals.cash_expense':   FieldValue.increment(dCashExpense),
    'totals.cash_balance':   FieldValue.increment(dCashBalance),
    'totals.online_income':  FieldValue.increment(dOnlineIncome),
    'totals.online_expense': FieldValue.increment(dOnlineExpense),
    'totals.online_balance': FieldValue.increment(dOnlineBalance),
  });
  await batch.commit();

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const oldSnap = await db.collection('expenses').doc(id).get();
  if (!oldSnap.exists)
    return NextResponse.json({ error: 'Expense not found' }, { status: 404 });
  const old = oldSnap.data()!;

  const isIncome = old.type === 'income';
  const isCash   = (old.payment_mode ?? 'cash') === 'cash';
  const amt      = old.amount as number;

  // Reverse the contribution of this expense from all totals
  const batch = db.batch();
  batch.delete(db.collection('expenses').doc(id));
  batch.update(db.collection('users').doc(old.userId), {
    'totals.total_income':   FieldValue.increment(isIncome  ? -amt : 0),
    'totals.total_expense':  FieldValue.increment(!isIncome ? -amt : 0),
    'totals.balance':        FieldValue.increment(isIncome  ? -amt : amt),
    'totals.cash_income':    FieldValue.increment(isCash  && isIncome  ? -amt : 0),
    'totals.cash_expense':   FieldValue.increment(isCash  && !isIncome ? -amt : 0),
    'totals.cash_balance':   FieldValue.increment(isCash  ? (isIncome ? -amt : amt) : 0),
    'totals.online_income':  FieldValue.increment(!isCash && isIncome  ? -amt : 0),
    'totals.online_expense': FieldValue.increment(!isCash && !isIncome ? -amt : 0),
    'totals.online_balance': FieldValue.increment(!isCash ? (isIncome ? -amt : amt) : 0),
  });
  await batch.commit();

  return NextResponse.json({ success: true });
}