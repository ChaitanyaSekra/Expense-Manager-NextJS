import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

// GET /api/users/[userId]/totals
// Returns the running totals stored on the user doc.
// This is a single document read — no expense scan needed.
// Totals are maintained by the POST/PUT/DELETE expense routes via FieldValue.increment.
//
// IMPORTANT: If a user's totals field doesn't exist yet (existing users before this change),
// this endpoint falls back to scanning all expenses and writing the totals to the user doc.
// After that one-time backfill, all future calls are a single read.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const userSnap = await db.collection('users').doc(userId).get();
  if (!userSnap.exists) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const userData = userSnap.data()!;

  // ── Totals already exist — fast path (1 read total) ───────────────────────
  if (userData.totals) {
    const t = userData.totals;
    return NextResponse.json({
      total_income:   round(t.total_income   ?? 0),
      total_expense:  round(t.total_expense  ?? 0),
      balance:        round(t.balance        ?? 0),
      cash_income:    round(t.cash_income    ?? 0),
      cash_expense:   round(t.cash_expense   ?? 0),
      cash_balance:   round(t.cash_balance   ?? 0),
      online_income:  round(t.online_income  ?? 0),
      online_expense: round(t.online_expense ?? 0),
      online_balance: round(t.online_balance ?? 0),
    });
  }

  // ── One-time backfill for existing users ──────────────────────────────────
  // Scan all expenses once, write totals to the user doc, never do this again.
  const snap = await db.collection('expenses').where('userId', '==', userId).get();
  const rows = snap.docs.map(d => d.data());

  const total_income   = round(rows.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0));
  const total_expense  = round(rows.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0));
  const balance        = round(total_income - total_expense);

  const cashRows   = rows.filter(e => (e.payment_mode ?? 'cash') === 'cash');
  const onlineRows = rows.filter(e => (e.payment_mode ?? 'cash') === 'online');

  const cash_income    = round(cashRows.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0));
  const cash_expense   = round(cashRows.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0));
  const cash_balance   = round(cash_income - cash_expense);
  const online_income  = round(onlineRows.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0));
  const online_expense = round(onlineRows.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0));
  const online_balance = round(online_income - online_expense);

  const totals = {
    total_income, total_expense, balance,
    cash_income, cash_expense, cash_balance,
    online_income, online_expense, online_balance,
  };

  // Write totals to user doc so future calls skip the scan
  await db.collection('users').doc(userId).update({ totals });

  return NextResponse.json(totals);
}

function round(n: number) { return Math.round(n * 100) / 100; }