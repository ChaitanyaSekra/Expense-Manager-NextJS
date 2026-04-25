import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

interface Expense {
  id: string; amount: number; type: string;
  category: string; description: string; date: string;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const url = new URL(req.url);
  const dateFrom = url.searchParams.get('date_from');
  const dateTo   = url.searchParams.get('date_to');

  let query = db.collection('expenses').where('userId', '==', userId);
  // Firestore can filter on date string (ISO format sorts lexicographically)
  if (dateFrom) query = query.where('date', '>=', dateFrom) as typeof query;
  if (dateTo)   query = query.where('date', '<=', dateTo)   as typeof query;

  const snap = await query.get();

  const items: Expense[] = snap.docs
    .map(d => ({ id: d.id, ...d.data() } as Expense))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  let totalIncome = 0, totalExpense = 0;
  const groups: Record<string, { category: string; net: number; total: number; _is_income: boolean; expenses: Expense[] }> = {};
  const usedCats = new Set<string>();

  for (const exp of items) {
    const cat = exp.category || 'Uncategorized';
    usedCats.add(cat);
    if (!groups[cat]) groups[cat] = { category: cat, net: 0, total: 0, _is_income: false, expenses: [] };
    if (exp.type === 'income') { totalIncome  += exp.amount; groups[cat].net += exp.amount; }
    else                       { totalExpense += exp.amount; groups[cat].net -= exp.amount; }
    groups[cat].expenses.push(exp);
  }

  totalIncome  = Math.round(totalIncome  * 100) / 100;
  totalExpense = Math.round(totalExpense * 100) / 100;

  for (const g of Object.values(groups)) {
    g.net = Math.round(g.net * 100) / 100;
    g.total = Math.abs(g.net);
    g._is_income = g.net >= 0;
  }

  const incomeGroups  = Object.values(groups).filter(g =>  g._is_income).sort((a,b) => b.net - a.net);
  const expenseGroups = Object.values(groups).filter(g => !g._is_income).sort((a,b) => a.net - b.net);

  return NextResponse.json({
    groups: [...incomeGroups, ...expenseGroups],
    total_income:    totalIncome,
    total_expense:   totalExpense,
    balance:         Math.round((totalIncome - totalExpense) * 100) / 100,
    used_categories: [...usedCats],
  });
}