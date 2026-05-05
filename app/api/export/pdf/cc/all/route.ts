import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

interface CCExpense {
  id: string;
  userId: string;
  amount: number;
  category: string;
  description: string;
  date: string;
}

function round(n: number) { return Math.round(n * 100) / 100; }
function fmt(n: number) {
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export async function GET(req: Request) {
  const url      = new URL(req.url);
  const mode     = url.searchParams.get('mode') || 'month';
  const detailed = url.searchParams.get('detailed') === 'true';

  let date_from = '';
  let date_to   = '';
  let dateLabel = '';

  if (mode === 'month') {
    const month = parseInt(url.searchParams.get('month') || '1');
    const year  = parseInt(url.searchParams.get('year')  || String(new Date().getFullYear()));
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

  // Fetch all users
  const usersSnap = await db.collection('users').get();
  const users: Record<string, string> = {};
  usersSnap.docs.forEach(d => { users[d.id] = d.data().name as string; });

  // Fetch all CC expenses in date range
  const snap = await db.collection('cc_expenses')
    .where('date', '>=', date_from)
    .where('date', '<=', date_to)
    .get();

  const allRows: CCExpense[] = snap.docs
    .map(d => ({ id: d.id, ...d.data() } as CCExpense))
    .sort((a, b) => b.date.localeCompare(a.date));

  // Group by user
  const byUser: Record<string, CCExpense[]> = {};
  for (const e of allRows) {
    if (!byUser[e.userId]) byUser[e.userId] = [];
    byUser[e.userId].push(e);
  }

  const grandTotal = round(allRows.reduce((s, e) => s + e.amount, 0));

  // Build per-user sections
  const userSections = Object.entries(byUser).map(([uid, rows]) => {
    const userName   = users[uid] || uid;
    const userTotal  = round(rows.reduce((s, e) => s + e.amount, 0));

    const groups: Record<string, { total: number; expenses: CCExpense[] }> = {};
    for (const e of rows) {
      const cat = e.category || 'Uncategorized';
      if (!groups[cat]) groups[cat] = { total: 0, expenses: [] };
      groups[cat].total += e.amount;
      groups[cat].expenses.push(e);
    }
    for (const g of Object.values(groups)) g.total = round(g.total);
    const sorted = Object.entries(groups).sort(([, a], [, b]) => b.total - a.total);

    const catRows = sorted.map(([cat, g]) => {
      const detailRows = detailed
        ? g.expenses
            .sort((a, b) => b.date.localeCompare(a.date))
            .map(e => `
              <tr>
                <td style="padding-left:28px;color:#999;font-size:11px;">${e.description || '—'}</td>
                <td style="color:#999;font-size:11px;">${formatDate(e.date)}</td>
                <td style="text-align:right;color:#ccc;font-size:11px;">₹${fmt(e.amount)}</td>
              </tr>`)
            .join('')
        : '';
      return `
        <tr class="cat-row">
          <td><strong>${cat}</strong><span class="count">${g.expenses.length} item${g.expenses.length !== 1 ? 's' : ''}</span></td>
          <td></td>
          <td style="text-align:right;color:#e8c547;font-weight:600;">₹${fmt(g.total)}</td>
        </tr>${detailRows}`;
    }).join('');

    return `
      <div class="user-section">
        <div class="user-header">
          <div class="user-name">${userName}</div>
          <div class="user-total">₹${fmt(userTotal)}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th></th>
              <th style="text-align:right">Amount</th>
            </tr>
          </thead>
          <tbody>${catRows}</tbody>
        </table>
      </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>CC Report – All Members – ${dateLabel}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #0f0f11; color: #f0ede8; padding: 32px 28px; }
  .header { border-bottom: 2px solid #e8c547; padding-bottom: 18px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
  .title { font-size: 24px; font-weight: 700; color: #e8c547; letter-spacing: -0.5px; }
  .subtitle { font-size: 13px; color: #7a7880; margin-top: 4px; }
  .meta { text-align: right; }
  .meta .period { font-size: 13px; color: #7a7880; }
  .grand-summary { background: #17171b; border: 1px solid #2a2a34; border-radius: 10px; padding: 16px 20px; margin-bottom: 28px; display: flex; justify-content: space-between; align-items: center; }
  .grand-label { font-size: 11px; color: #7a7880; text-transform: uppercase; letter-spacing: 0.08em; }
  .grand-val { font-size: 22px; font-weight: 700; color: #e05c5c; margin-top: 4px; }
  .user-section { margin-bottom: 32px; }
  .user-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1.5px solid #e8c547; margin-bottom: 8px; }
  .user-name { font-size: 16px; font-weight: 700; color: #f0ede8; }
  .user-total { font-size: 16px; font-weight: 700; color: #e05c5c; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #4e4c56; padding: 7px 10px; border-bottom: 1px solid #2a2a34; text-align: left; }
  th:last-child { text-align: right; }
  .cat-row td { padding: 11px 10px; border-bottom: 1px solid #1e1e24; vertical-align: middle; }
  .cat-row td strong { font-size: 13px; color: #f0ede8; display: block; }
  .count { font-size: 10px; color: #4e4c56; margin-top: 2px; display: block; }
  .footer { margin-top: 32px; border-top: 1px solid #2a2a34; padding-top: 14px; display: flex; justify-content: space-between; font-size: 11px; color: #4e4c56; }
  .cc-badge { display: inline-block; background: rgba(232,197,71,0.1); border: 1px solid #a8892a; color: #e8c547; font-size: 10px; padding: 2px 8px; border-radius: 12px; margin-left: 8px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">💳 All Members CC Report<span class="cc-badge">CC</span></div>
      <div class="subtitle">Sekra Budget Tracker</div>
    </div>
    <div class="meta">
      <div class="period">${dateLabel}</div>
    </div>
  </div>

  <div class="grand-summary">
    <div>
      <div class="grand-label">Grand Total Spent</div>
      <div class="grand-val">₹${fmt(grandTotal)}</div>
    </div>
    <div style="text-align:right">
      <div class="grand-label">Members</div>
      <div style="font-size:18px;font-weight:700;color:#f0ede8;margin-top:4px;">${Object.keys(byUser).length}</div>
    </div>
  </div>

  ${allRows.length === 0
    ? `<div style="text-align:center;padding:48px;color:#4e4c56;font-size:14px;">No credit card entries for this period.</div>`
    : userSections
  }

  <div class="footer">
    <span>Generated by Sekra · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
    <span>Credit Card · All Members</span>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="cc-report-all-${date_from}.html"`,
    },
  });
}