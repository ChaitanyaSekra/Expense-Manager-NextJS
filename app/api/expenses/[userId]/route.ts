import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

interface Expense {
  id: string;
  amount: number;
  type: string;
  category: string;
  description: string;
  date: string;
  payment_mode?: string; // 'cash' | 'online' — old records may be missing this field
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;

  const url        = new URL(req.url);
  const date_from  = url.searchParams.get('date_from') || '';
  const date_to    = url.searchParams.get('date_to')   || '';

  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  let query = db.collection('expenses').where('userId', '==', userId);

  if (date_from) query = query.where('date', '>=', date_from) as typeof query;
  if (date_to)   query = query.where('date', '<=', date_to)   as typeof query;

  const snap = await query.get();

  const rows: Expense[] = snap.docs
    .map(d => ({ id: d.id, ...d.data() } as Expense))
    .sort((a, b) => b.date.localeCompare(a.date));

  const total_income  = Math.round(rows.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0) * 100) / 100;
  const total_expense = Math.round(rows.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0) * 100) / 100;
  const balance       = Math.round((total_income - total_expense) * 100) / 100;

  // ── Cash / Online splits (treat missing payment_mode as 'cash') ───────────
  const cashRows   = rows.filter(e => (e.payment_mode || 'cash') === 'cash');
  const onlineRows = rows.filter(e => (e.payment_mode || 'cash') === 'online');

  const cash_income   = Math.round(cashRows.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0) * 100) / 100;
  const cash_expense  = Math.round(cashRows.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0) * 100) / 100;
  const cash_balance  = Math.round((cash_income - cash_expense) * 100) / 100;

  const online_income  = Math.round(onlineRows.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0) * 100) / 100;
  const online_expense = Math.round(onlineRows.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0) * 100) / 100;
  const online_balance = Math.round((online_income - online_expense) * 100) / 100;

  // ── Group by category ─────────────────────────────────────────────────────
  const groups: Record<string, {
    net: number; total: number; _is_income: boolean; expenses: Expense[];
  }> = {};

  for (const e of rows) {
    const cat = e.category || 'Uncategorized';
    if (!groups[cat]) groups[cat] = { net: 0, total: 0, _is_income: false, expenses: [] };
    groups[cat].net   += e.type === 'income' ? e.amount : -e.amount;
    groups[cat].total += e.amount;
    groups[cat].expenses.push(e);
  }
  for (const g of Object.values(groups)) {
    g.net        = Math.round(g.net * 100) / 100;
    g.total      = Math.round(g.total * 100) / 100;
    g._is_income = g.net >= 0;
  }

  const incomeGroups  = Object.entries(groups).filter(([, g]) =>  g._is_income).sort(([, a], [, b]) => b.net - a.net);
  const expenseGroups = Object.entries(groups).filter(([, g]) => !g._is_income).sort(([, a], [, b]) => a.net - b.net);
  const sortedGroups  = [...incomeGroups, ...expenseGroups];

  return NextResponse.json({
    groups: sortedGroups.map(([category, g]) => ({ category, ...g })),
    total_income,
    total_expense,
    balance,
    // Payment-mode splits (used by the balance card)
    cash_balance,
    cash_income,
    cash_expense,
    online_balance,
    online_income,
    online_expense,
    used_categories: Object.keys(groups),
  });
}
