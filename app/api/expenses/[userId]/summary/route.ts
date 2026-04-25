import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const sixDaysAgo = new Date();
  sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
  const fromDate = sixDaysAgo.toISOString().slice(0, 10);

  const snap = await db.collection('expenses')
    .where('userId', '==', userId)
    .where('type', '==', 'expense')
    .where('date', '>=', fromDate)
    .get();

  // Group by date in JS
  const totals: Record<string, number> = {};
  for (const doc of snap.docs) {
    const { date, amount } = doc.data();
    totals[date] = (totals[date] || 0) + amount;
  }

  const result = Object.entries(totals)
    .map(([date, total]) => ({ date, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json(result);
}