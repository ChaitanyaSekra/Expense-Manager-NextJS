import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

interface Expense {
  id: string;
  amount: number;
  type: string;
  category: string;
  description: string;
  date: string;
  createdAt: string;
  payment_mode?: string;
}

const PAGE_SIZE = 10;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const url       = new URL(req.url);
  const date_from = url.searchParams.get('date_from') || '';
  const date_to   = url.searchParams.get('date_to')   || '';
  const cursor    = url.searchParams.get('cursor')    || ''; // createdAt of last doc

  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  // ── PAGINATED ALL-TIME MODE ───────────────────────────────────────────────
  // Used when no date filter is active. Only reads PAGE_SIZE docs per request.
  // Totals come from users/{userId}.totals (maintained by POST/PUT/DELETE).
  if (!date_from && !date_to) {
    let pgQuery = db.collection('expenses')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(PAGE_SIZE + 1); // fetch one extra to detect hasMore

    if (cursor) pgQuery = pgQuery.startAfter(cursor) as typeof pgQuery;

    const pgSnap = await pgQuery.get();
    const hasMore = pgSnap.docs.length > PAGE_SIZE;
    const docs    = pgSnap.docs.slice(0, PAGE_SIZE);
    const rows: Expense[] = docs.map(d => ({ id: d.id, ...d.data() } as Expense));
    const nextCursor = hasMore ? docs[docs.length - 1].data().createdAt as string : null;

    // Group by category for the transaction list display
    const groups = buildGroups(rows);

    return NextResponse.json({
      groups,
      hasMore,
      nextCursor,
      // Totals are intentionally omitted here — the frontend reads them
      // from /api/users/[userId]/totals (a single doc read)
    });
  }

  // ── FILTERED MODE ─────────────────────────────────────────────────────────
  // Date-bounded queries are small enough to fetch all at once.
  let query = db.collection('expenses').where('userId', '==', userId);
  if (date_from) query = query.where('date', '>=', date_from) as typeof query;
  if (date_to)   query = query.where('date', '<=', date_to)   as typeof query;

  const snap = await query.get();
  const rows: Expense[] = snap.docs
    .map(d => ({ id: d.id, ...d.data() } as Expense))
    .sort((a, b) => b.date.localeCompare(a.date));

  const total_income  = round(rows.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0));
  const total_expense = round(rows.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0));
  const balance       = round(total_income - total_expense);

  const cashRows   = rows.filter(e => (e.payment_mode || 'cash') === 'cash');
  const onlineRows = rows.filter(e => (e.payment_mode || 'cash') === 'online');

  const cash_income    = round(cashRows.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0));
  const cash_expense   = round(cashRows.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0));
  const cash_balance   = round(cash_income - cash_expense);
  const online_income  = round(onlineRows.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0));
  const online_expense = round(onlineRows.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0));
  const online_balance = round(online_income - online_expense);

  return NextResponse.json({
    groups: buildGroups(rows),
    total_income, total_expense, balance,
    cash_balance, cash_income, cash_expense,
    online_balance, online_income, online_expense,
    used_categories: [...new Set(rows.map(e => e.category || 'Uncategorized'))],
    hasMore: false,
    nextCursor: null,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function round(n: number) { return Math.round(n * 100) / 100; }

function buildGroups(rows: Expense[]) {
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
    g.net        = round(g.net);
    g.total      = round(g.total);
    g._is_income = g.net >= 0;
  }

  const incomeGroups  = Object.entries(groups).filter(([, g]) =>  g._is_income).sort(([, a], [, b]) => b.net - a.net);
  const expenseGroups = Object.entries(groups).filter(([, g]) => !g._is_income).sort(([, a], [, b]) => a.net - b.net);

  return [...incomeGroups, ...expenseGroups].map(([category, g]) => ({ category, ...g }));
}