import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

interface CCExpense {
  id: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  createdAt: string;
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
  const cursor    = url.searchParams.get('cursor')    || '';
  const categoriesParam = url.searchParams.get('categories') || '';
  const categoryFilter  = categoriesParam ? categoriesParam.split(',').map(c => c.trim()).filter(Boolean) : [];

  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  // ── PAGINATED ALL-TIME MODE ───────────────────────────────────────────────
  if (!date_from && !date_to) {
    let q = db.collection('cc_expenses')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(PAGE_SIZE + 1);

    if (categoryFilter.length > 0) q = q.where('category', 'in', categoryFilter) as typeof q;
    if (cursor) q = q.startAfter(cursor) as typeof q;

    const snap    = await q.get();
    const hasMore = snap.docs.length > PAGE_SIZE;
    const docs    = snap.docs.slice(0, PAGE_SIZE);
    const rows: CCExpense[] = docs.map(d => ({ id: d.id, ...d.data() } as CCExpense));
    const nextCursor = hasMore ? docs[docs.length - 1].data().createdAt as string : null;

    return NextResponse.json({ groups: buildGroups(rows), hasMore, nextCursor });
  }

  // ── FILTERED MODE ─────────────────────────────────────────────────────────
  let q = db.collection('cc_expenses').where('userId', '==', userId);
  if (date_from) q = q.where('date', '>=', date_from) as typeof q;
  if (date_to)   q = q.where('date', '<=', date_to)   as typeof q;
  if (categoryFilter.length > 0) q = q.where('category', 'in', categoryFilter) as typeof q;

  const snap = await q.get();
  const rows: CCExpense[] = snap.docs
    .map(d => ({ id: d.id, ...d.data() } as CCExpense))
    .sort((a, b) => b.date.localeCompare(a.date));

  const total_spent = round(rows.reduce((s, e) => s + e.amount, 0));

  return NextResponse.json({
    groups: buildGroups(rows),
    total_spent,
    used_categories: [...new Set(rows.map(e => e.category || 'Uncategorized'))],
    hasMore: false,
    nextCursor: null,
  });
}

function round(n: number) { return Math.round(n * 100) / 100; }

function buildGroups(rows: CCExpense[]) {
  const groups: Record<string, { total: number; expenses: CCExpense[] }> = {};

  for (const e of rows) {
    const cat = e.category || 'Uncategorized';
    if (!groups[cat]) groups[cat] = { total: 0, expenses: [] };
    groups[cat].total += e.amount;
    groups[cat].expenses.push(e);
  }
  for (const g of Object.values(groups)) {
    g.total = round(g.total);
  }

  return Object.entries(groups)
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([category, g]) => ({ category, ...g }));
}