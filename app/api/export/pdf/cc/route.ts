import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

interface CCExpense {
  id: string;
  amount: number;
  category: string;
  description: string;
  date: string;
}

function round(n: number) { return Math.round(n * 100) / 100; }

function fmt(n: number) {
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function buildPDF(
  userName: string,
  rows: CCExpense[],
  dateLabel: string,
  detailed: boolean,
): string {
  const total = round(rows.reduce((s, e) => s + e.amount, 0));

  // Group by category
  const groups: Record<string, { total: number; expenses: CCExpense[] }> = {};
  for (const e of rows) {
    const cat = e.category || 'Uncategorized';
    if (!groups[cat]) groups[cat] = { total: 0, expenses: [] };
    groups[cat].total += e.amount;
    groups[cat].expenses.push(e);
  }
  for (const g of Object.values(groups)) g.total = round(g.total);
  const sorted = Object.entries(groups).sort(([, a], [, b]) => b.total - a.total);

  const formatDate = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const categoryRows = sorted.map(([cat, g]) => {
    const detailRows = detailed
      ? g.expenses
          .sort((a, b) => b.date.localeCompare(a.date))
          .map(
            e => `
          <tr class="detail-row">
            <td style="padding-left:28px;color:#999;font-size:11px;">${e.description || '—'}</td>
            <td style="color:#999;font-size:11px;">${formatDate(e.date)}</td>
            <td style="text-align:right;color:#ccc;font-size:11px;">₹${fmt(e.amount)}</td>
          </tr>`
          )
          .join('')
      : '';

    return `
      <tr class="cat-row">
        <td><strong>${cat}</strong><span class="count">${g.expenses.length} item${g.expenses.length !== 1 ? 's' : ''}</span></td>
        <td></td>
        <td style="text-align:right;color:#e8c547;font-weight:600;">₹${fmt(g.total)}</td>
      </tr>
      ${detailRows}`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Credit Card Report – ${userName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #0f0f11; color: #f0ede8; padding: 32px 28px; }
  .header { border-bottom: 2px solid #e8c547; padding-bottom: 18px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
  .title { font-size: 24px; font-weight: 700; color: #e8c547; letter-spacing: -0.5px; }
  .subtitle { font-size: 13px; color: #7a7880; margin-top: 4px; }
  .meta { text-align: right; }
  .meta .user { font-size: 15px; font-weight: 600; color: #f0ede8; }
  .meta .period { font-size: 12px; color: #7a7880; margin-top: 3px; }
  .summary { display: flex; gap: 16px; margin-bottom: 28px; }
  .sum-box { flex: 1; background: #17171b; border: 1px solid #2a2a34; border-radius: 10px; padding: 14px 16px; }
  .sum-label { font-size: 10px; color: #7a7880; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
  .sum-val { font-size: 20px; font-weight: 700; color: #e05c5c; }
  .sum-val.count { color: #f0ede8; font-size: 18px; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #4e4c56; padding: 8px 10px; border-bottom: 1px solid #2a2a34; text-align: left; }
  th:last-child { text-align: right; }
  .cat-row td { padding: 12px 10px; border-bottom: 1px solid #1e1e24; vertical-align: middle; }
  .cat-row td strong { font-size: 13px; color: #f0ede8; display: block; }
  .count { font-size: 10px; color: #4e4c56; margin-top: 2px; display: block; }
  .detail-row td { padding: 5px 10px 5px 28px; border-bottom: 1px solid #17171b; }
  .footer { margin-top: 32px; border-top: 1px solid #2a2a34; padding-top: 14px; display: flex; justify-content: space-between; font-size: 11px; color: #4e4c56; }
  .cc-badge { display: inline-block; background: rgba(232,197,71,0.1); border: 1px solid #a8892a; color: #e8c547; font-size: 10px; padding: 2px 8px; border-radius: 12px; margin-left: 8px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">💳 Credit Card Report<span class="cc-badge">CC</span></div>
      <div class="subtitle">Sekra Budget Tracker</div>
    </div>
    <div class="meta">
      <div class="user">${userName}</div>
      <div class="period">${dateLabel}</div>
    </div>
  </div>

  <div class="summary">
    <div class="sum-box">
      <div class="sum-label">Total Spent</div>
      <div class="sum-val">₹${fmt(total)}</div>
    </div>
    <div class="sum-box">
      <div class="sum-label">Transactions</div>
      <div class="sum-val count">${rows.length}</div>
    </div>
    <div class="sum-box">
      <div class="sum-label">Categories</div>
      <div class="sum-val count">${sorted.length}</div>
    </div>
  </div>

  ${rows.length === 0
    ? `<div style="text-align:center;padding:48px;color:#4e4c56;font-size:14px;">No credit card entries for this period.</div>`
    : `<table>
        <thead>
          <tr>
            <th>Category</th>
            <th></th>
            <th style="text-align:right">Amount</th>
          </tr>
        </thead>
        <tbody>${categoryRows}</tbody>
      </table>`
  }

  <div class="footer">
    <span>Generated by Sekra · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
    <span>Credit Card Expenses</span>
  </div>
</body>
</html>`;
}

export async function GET(req: Request) {
  const url      = new URL(req.url);
  const userId   = url.searchParams.get('user_id') || '';
  const mode     = url.searchParams.get('mode') || 'month';
  const detailed = url.searchParams.get('detailed') === 'true';

  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 });

  // Resolve date range
  let date_from = '';
  let date_to   = '';
  let dateLabel = '';

  if (mode === 'month') {
    const month = parseInt(url.searchParams.get('month') || '1');
    const year  = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()));
    const pad   = (n: number) => String(n).padStart(2, '0');
    const lastDay = new Date(year, month, 0).getDate();
    date_from = `${year}-${pad(month)}-01`;
    date_to   = `${year}-${pad(month)}-${lastDay}`;
    dateLabel = new Date(year, month - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  } else {
    date_from = url.searchParams.get('date_from') || '';
    date_to   = url.searchParams.get('date_to')   || '';
    if (!date_from || !date_to) return NextResponse.json({ error: 'date_from and date_to required' }, { status: 400 });
    dateLabel = `${date_from} → ${date_to}`;
  }

  // Fetch user
  const userSnap = await db.collection('users').doc(userId).get();
  if (!userSnap.exists) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const userName = userSnap.data()!.name as string;

  // Fetch CC expenses
  let q = db.collection('cc_expenses')
    .where('userId', '==', userId)
    .where('date', '>=', date_from)
    .where('date', '<=', date_to);

  const snap = await q.get();
  const rows: CCExpense[] = snap.docs
    .map(d => ({ id: d.id, ...d.data() } as CCExpense))
    .sort((a, b) => b.date.localeCompare(a.date));

  const html = buildPDF(userName, rows, dateLabel, detailed);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="cc-report-${userName}-${date_from}.html"`,
    },
  });
}