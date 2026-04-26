import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

interface Expense {
  id: string;
  amount: number;
  type: string;
  category: string;
  description: string;
  date: string;
}

export async function GET(req: Request) {
  try {
    const url      = new URL(req.url);
    const mode     = url.searchParams.get('mode') || 'month';
    const detailed = url.searchParams.get('detailed') === 'true';

    // ── Determine date range ──────────────────────────────────────────────────
    let dateFrom: string, dateTo: string, periodLabel: string;

    if (mode === 'month') {
      // Use IST for current month default
      const nowIST  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const month   = parseInt(url.searchParams.get('month') || String(nowIST.getMonth() + 1));
      const year    = parseInt(url.searchParams.get('year')  || String(nowIST.getFullYear()));
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

    // ── Fetch all users ───────────────────────────────────────────────────────
    const usersSnap = await db.collection('users').get();
    const users = usersSnap.docs.map(d => ({ id: d.id, name: d.data().name as string }));
    // Build a lookup map: userId → name (for detailed view)
    const userNames: Record<string, string> = {};
    for (const u of users) userNames[u.id] = u.name;

    // ── Fetch ALL expenses across all users in date range ─────────────────────
    const money   = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const sign    = (n: number) => n >= 0 ? '+' : '−';
    const fmtDate = (d: string) => {
      try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
      catch { return d; }
    };

    // Firestore doesn't support OR across userIds, so fetch per user and pool
    const allRows: (Expense & { userName: string })[] = [];
    for (const user of users) {
      const snap = await db.collection('expenses')
        .where('userId', '==', user.id)
        .where('date', '>=', dateFrom)
        .where('date', '<=', dateTo)
        .get();
      for (const d of snap.docs) {
        allRows.push({ id: d.id, ...(d.data() as Omit<Expense, 'id'>), userName: user.name });
      }
    }
    // Sort all entries by date asc
    allRows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

    const totalIncome  = Math.round(allRows.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0) * 100) / 100;
    const totalExpense = Math.round(allRows.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0) * 100) / 100;
    const grandNet     = Math.round((totalIncome - totalExpense) * 100) / 100;

    // ── Group by category (pooled across all users) ───────────────────────────
    const groups: Record<string, { net: number; expenses: (Expense & { userName: string })[]; is_income: boolean }> = {};
    for (const e of allRows) {
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

    const catHtml = sortedGroups.map(([catName, g]) => {
      const itemsHtml = detailed ? g.expenses.map(e => `
        <tr class="item-row">
          <td class="item-desc">
            ${e.description || '—'}
            <span class="item-date">${fmtDate(e.date)}</span>
            <span class="item-user">${e.userName}</span>
          </td>
          <td class="item-amt ${e.type}">${e.type === 'income' ? '+' : '−'}${money(e.amount)}</td>
        </tr>`).join('') : '';
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
        </div>`;
    }).join('');
    const exportedOn = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sekra — All Members — ${periodLabel}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', system-ui, sans-serif; background: #fff; color: #111; font-size: 13px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { max-width: 680px; margin: 0 auto; padding: 32px 28px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .app-name { font-family: 'DM Serif Display', serif; font-size: 28px; color: #e8c547; font-style: italic; }
  .meta { font-size: 10px; color: #7a7880; text-align: right; margin-top: 4px; }
  .period { font-size: 13px; color: #7a7880; margin-top: 2px; }
  .report-title { font-size: 16px; font-weight: 600; color: #111; margin-top: 2px; }
  hr { border: none; border-top: 1.5px solid #e8c547; margin: 14px 0; }
  hr.soft { border-color: #ddd; border-width: 0.5px; margin: 10px 0; }

  /* Grand summary */
  .grand-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 24px; }
  .summary-card { background: #f2f2f2; border-radius: 8px; padding: 12px 14px; text-align: center; }
  .card-label { font-size: 9px; color: #7a7880; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }
  .card-value { font-weight: 700; font-size: 15px; }
  .card-value.income  { color: #2a9d5c; }
  .card-value.expense { color: #e05c5c; }
  .card-value.positive { color: #2a9d5c; }
  .card-value.negative { color: #e05c5c; }

  .section-label { font-size: 9px; font-weight: 600; color: #7a7880; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 8px; }

  /* Category blocks */
  .cat-block { margin-bottom: 8px; }
  .cat-table { width: 100%; border-collapse: collapse; background: #f5f5f5; border-radius: 8px; overflow: hidden; }
  .cat-header td { padding: 9px 12px; font-weight: 600; font-size: 13px; }
  .cat-header.income-cat  { border-left: 3px solid #e8c547; }
  .cat-header.expense-cat { border-left: 3px solid #e05c5c; }
  .cat-name { color: #111; }
  .cat-net { text-align: right; }
  .income-cat  .cat-net { color: #2a9d5c; }
  .expense-cat .cat-net { color: #e05c5c; }
  .item-row td { padding: 5px 12px 5px 24px; border-top: 0.5px solid #e0e0e0; font-size: 12px; }
  .item-desc { color: #333; }
  .item-date { display: inline-block; margin-left: 8px; font-size: 10px; color: #7a7880; }
  .item-user { display: inline-block; margin-left: 6px; font-size: 10px; color: #bbb; background: #ebebeb; border-radius: 3px; padding: 0 4px; }
  .item-amt { text-align: right; font-weight: 500; }
  .item-amt.income  { color: #2a9d5c; }
  .item-amt.expense { color: #e05c5c; }
  .cat-count { font-size: 10px; color: #7a7880; padding: 3px 12px; }

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
      <div class="report-title">All Members Report</div>
    </div>
    <div class="meta">Exported on<br>${exportedOn} IST</div>
  </div>
  <hr>
  <div class="grand-grid">
    <div class="summary-card">
      <div class="card-label">Total Income</div>
      <div class="card-value income">${money(totalIncome)}</div>
    </div>
    <div class="summary-card">
      <div class="card-label">Total Expenses</div>
      <div class="card-value expense">${money(totalExpense)}</div>
    </div>
    <div class="summary-card">
      <div class="card-label">Net Balance</div>
      <div class="card-value ${grandNet >= 0 ? 'positive' : 'negative'}">${sign(grandNet)}${money(grandNet)}</div>
    </div>
  </div>
  <div class="section-label">Transactions by category · ${users.length} members · ${allRows.length} entries</div>
  <hr class="soft">
  ${allRows.length === 0
    ? '<p style="color:#7a7880;text-align:center;padding:20px">No transactions for this period.</p>'
    : catHtml}
  <div class="footer">Generated by Sekra Budget Tracker · ${exportedOn} IST · All Members</div>
</div>
<script>window.onload = () => window.print();<\/script>
</body>
</html>`;

    const safePeriod = periodLabel.replace(/\s+/g, '_').replace(/,/g, '');
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="Sekra_All_Members_${safePeriod}.html"`,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}