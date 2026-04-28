import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

interface Expense {
  id: string;
  amount: number;
  type: string;
  category: string;
  description: string;
  date: string;
  payment_mode?: string;
}

export async function GET(req: Request) {
  try {
    const url      = new URL(req.url);
    const userId   = url.searchParams.get('user_id') || '';
    const mode     = url.searchParams.get('mode') || 'month';
    const detailed = url.searchParams.get('detailed') === 'true';

    if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 });

    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const userName = userSnap.data()!.name as string;

    let dateFrom: string, dateTo: string, periodLabel: string;

    if (mode === 'month') {
      const now     = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const month   = parseInt(url.searchParams.get('month') || String(now.getMonth() + 1));
      const year    = parseInt(url.searchParams.get('year')  || String(now.getFullYear()));
      const lastDay = new Date(year, month, 0).getDate();
      dateFrom    = `${year}-${String(month).padStart(2, '0')}-01`;
      dateTo      = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      periodLabel = new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    } else {
      dateFrom = url.searchParams.get('date_from') || '';
      dateTo   = url.searchParams.get('date_to')   || '';
      if (!dateFrom || !dateTo)
        return NextResponse.json({ error: 'date_from and date_to required' }, { status: 400 });
      const fmt = (d: string) => {
        try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
        catch { return d; }
      };
      periodLabel = `${fmt(dateFrom)} to ${fmt(dateTo)}`;
    }

    const snap = await db.collection('expenses')
      .where('userId', '==', userId)
      .where('date', '>=', dateFrom)
      .where('date', '<=', dateTo)
      .get();

    const rows: Expense[] = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as Expense))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totalIncome  = Math.round(rows.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0) * 100) / 100;
    const totalExpense = Math.round(rows.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0) * 100) / 100;
    const balance      = Math.round((totalIncome - totalExpense) * 100) / 100;

    // ── Cash / Online splits ──────────────────────────────────────────────────
    const cashRows   = rows.filter(e => (e.payment_mode || 'cash') === 'cash');
    const onlineRows = rows.filter(e => (e.payment_mode || 'cash') === 'online');
    const cashIncome   = Math.round(cashRows.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0) * 100) / 100;
    const cashExpense  = Math.round(cashRows.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0) * 100) / 100;
    const cashBalance  = Math.round((cashIncome - cashExpense) * 100) / 100;
    const onlineIncome  = Math.round(onlineRows.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0) * 100) / 100;
    const onlineExpense = Math.round(onlineRows.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0) * 100) / 100;
    const onlineBalance = Math.round((onlineIncome - onlineExpense) * 100) / 100;

    // ── Group by category ─────────────────────────────────────────────────────
    const groups: Record<string, { net: number; expenses: Expense[]; is_income: boolean }> = {};
    for (const e of rows) {
      const cat = e.category || 'Uncategorized';
      if (!groups[cat]) groups[cat] = { net: 0, expenses: [], is_income: false };
      groups[cat].net += e.type === 'income' ? e.amount : -e.amount;
      groups[cat].expenses.push(e);
    }
    for (const g of Object.values(groups)) {
      g.net = Math.round(g.net * 100) / 100;
      g.is_income = g.net >= 0;
    }

    const incomeGroups  = Object.entries(groups).filter(([, g]) =>  g.is_income).sort(([, a], [, b]) => b.net - a.net);
    const expenseGroups = Object.entries(groups).filter(([, g]) => !g.is_income).sort(([, a], [, b]) => a.net - b.net);
    const sortedGroups  = [...incomeGroups, ...expenseGroups];

    const money   = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const sign    = (n: number) => n >= 0 ? '+' : '−';
    const fmtDate = (d: string) => {
      try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
      catch { return d; }
    };
    const exportedOn = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    const payBadge = (e: Expense) => {
      const mode = e.payment_mode || 'cash';
      return `<span class="pay-badge ${mode}">${mode === 'online' ? '⚡ Online' : '💵 Cash'}</span>`;
    };

    const categoriesHtml = sortedGroups.map(([catName, g]) => {
      const itemsHtml = detailed ? g.expenses.map(e => `
        <tr class="item-row">
          <td class="item-desc">
            ${e.description || '—'}
            <span class="item-date">${fmtDate(e.date)}</span>
            ${payBadge(e)}
          </td>
          <td class="item-amt ${e.type}">${e.type === 'income' ? '+' : '−'}${money(e.amount)}</td>
        </tr>
      `).join('') : '';

      return `
        <div class="cat-block">
          <table class="cat-table">
            <tr class="cat-header ${g.is_income ? 'income-cat' : 'expense-cat'}">
              <td class="cat-name">${catName}</td>
              <td class="cat-net">${sign(g.net)}${money(g.net)}</td>
            </tr>
            ${itemsHtml}
          </table>
          <div class="cat-count">${g.expenses.length} item${g.expenses.length !== 1 ? 's' : ''}</div>
        </div>
      `;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sekra — ${userName} — ${periodLabel}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', system-ui, sans-serif; background: #fff; color: #111; font-size: 13px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { max-width: 680px; margin: 0 auto; padding: 32px 28px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .app-name { font-family: 'DM Serif Display', serif; font-size: 28px; color: #e8c547; font-style: italic; }
  .meta { font-size: 10px; color: #7a7880; text-align: right; margin-top: 4px; }
  .period { font-size: 13px; color: #7a7880; margin-top: 2px; }
  .user-name { font-size: 16px; font-weight: 600; color: #111; margin-top: 2px; }
  hr { border: none; border-top: 1.5px solid #e8c547; margin: 14px 0; }
  hr.soft { border-color: #ddd; border-width: 0.5px; margin: 10px 0; }

  /* Summary cards */
  .summary-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 12px; }
  .summary-card { background: #f2f2f2; border-radius: 8px; padding: 12px 14px; text-align: center; }
  .card-label { font-size: 9px; color: #7a7880; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }
  .card-value { font-weight: 700; font-size: 15px; }
  .card-value.income  { color: #2a9d5c; }
  .card-value.expense { color: #e05c5c; }
  .card-value.balance-pos { color: #2a9d5c; }
  .card-value.balance-neg { color: #e05c5c; }

  /* Cash / Online split row */
  .pay-split { display: flex; gap: 8px; margin-bottom: 20px; }
  .pay-split-card {
    flex: 1; background: #fafafa; border: 1px solid #e8e8e8;
    border-radius: 8px; padding: 9px 12px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .pay-split-label { font-size: 10px; color: #7a7880; display: flex; align-items: center; gap: 4px; }
  .pay-split-label .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
  .pay-split-label .dot.cash   { background: #7a7880; }
  .pay-split-label .dot.online { background: #4a90d9; }
  .pay-split-val { font-size: 12px; font-weight: 600; color: #111; }

  .section-label { font-size: 9px; font-weight: 600; color: #7a7880; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 8px; }
  .cat-block { margin-bottom: 8px; }
  .cat-table { width: 100%; border-collapse: collapse; background: #f5f5f5; border-radius: 8px; overflow: hidden; }
  .cat-header td { padding: 10px 12px; font-weight: 600; font-size: 13px; }
  .cat-header.income-cat  { border-left: 3px solid #e8c547; }
  .cat-header.expense-cat { border-left: 3px solid #e05c5c; }
  .cat-name { color: #111; }
  .cat-net { text-align: right; }
  .income-cat  .cat-net { color: #2a9d5c; }
  .expense-cat .cat-net { color: #e05c5c; }
  .item-row td { padding: 6px 12px 6px 24px; border-top: 0.5px solid #e0e0e0; font-size: 12px; }
  .item-desc { color: #333; }
  .item-date { display: inline-block; margin-left: 8px; font-size: 10px; color: #7a7880; }
  .item-amt { text-align: right; font-weight: 500; }
  .item-amt.income  { color: #2a9d5c; }
  .item-amt.expense { color: #e05c5c; }
  .cat-count { font-size: 10px; color: #7a7880; padding: 3px 12px; }

  /* Payment mode badge in detailed rows */
  .pay-badge {
    display: inline-block; margin-left: 6px;
    font-size: 9px; font-weight: 500;
    border-radius: 3px; padding: 1px 5px;
    vertical-align: middle;
  }
  .pay-badge.cash   { background: #f0f0f0; color: #7a7880; }
  .pay-badge.online { background: #e8f0fb; color: #4a90d9; }

  .footer { margin-top: 24px; padding-top: 10px; border-top: 0.5px solid #ddd; font-size: 10px; color: #aaa; text-align: center; }
  @media print {
    body { font-size: 12px; }
    .page { padding: 20px; }
    .cat-block { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="app-name">Sekra</div>
      <div class="period">${periodLabel}</div>
      <div class="user-name">${userName}</div>
    </div>
    <div class="meta">Exported on<br>${exportedOn}</div>
  </div>
  <hr>

  <!-- Main summary cards -->
  <div class="summary-grid">
    <div class="summary-card">
      <div class="card-label">Income</div>
      <div class="card-value income">${money(totalIncome)}</div>
    </div>
    <div class="summary-card">
      <div class="card-label">Expenses</div>
      <div class="card-value expense">${money(totalExpense)}</div>
    </div>
    <div class="summary-card">
      <div class="card-label">Balance</div>
      <div class="card-value ${balance >= 0 ? 'balance-pos' : 'balance-neg'}">${balance < 0 ? '−' : ''}${money(balance)}</div>
    </div>
  </div>

  <!-- Cash / Online split -->
  <div class="pay-split">
    <div class="pay-split-card">
      <div class="pay-split-label"><span class="dot cash"></span> Cash balance</div>
      <div class="pay-split-val" style="color:${cashBalance >= 0 ? '#2a9d5c' : '#e05c5c'}">${cashBalance < 0 ? '−' : ''}${money(cashBalance)}</div>
    </div>
    <div class="pay-split-card">
      <div class="pay-split-label"><span class="dot online"></span> Online balance</div>
      <div class="pay-split-val" style="color:${onlineBalance >= 0 ? '#2a9d5c' : '#e05c5c'}">${onlineBalance < 0 ? '−' : ''}${money(onlineBalance)}</div>
    </div>
  </div>

  <div class="section-label">Transactions by category</div>
  <hr class="soft">
  ${rows.length === 0
    ? '<p style="color:#7a7880;text-align:center;padding:20px">No transactions for this period.</p>'
    : categoriesHtml}
  <div class="footer">Generated by Sekra Budget Tracker · ${exportedOn} · ${userName}</div>
</div>
<script>window.onload = () => window.print();</script>
</body>
</html>`;

    const safePeriod = periodLabel.replace(/\s+/g, '_').replace(/,/g, '');
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="Sekra_${userName}_${safePeriod}.html"`,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
