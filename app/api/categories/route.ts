import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

// ── Seed categories (written once if collection is empty) ─────────────────────
const SEED_CATEGORIES = [
  { name: 'Len-Den',       emoji: '🤝' },
  { name: 'Transport',     emoji: '🚌' },
  { name: 'Food',          emoji: '🍽️' },
  { name: 'Shopping',      emoji: '🛍️' },
  { name: 'Groceries',     emoji: '🛒' },
  { name: 'Bills',         emoji: '💡' },
  { name: 'Entertainment', emoji: '🎉' },
];

export async function GET() {
  const snap = await db.collection('categories').orderBy('createdAt', 'asc').get();

  // First-time seed: if the collection is empty, populate with defaults
  if (snap.empty) {
    const batch = db.batch();
    const now = new Date().toISOString();
    for (const cat of SEED_CATEGORIES) {
      const ref = db.collection('categories').doc();
      batch.set(ref, { ...cat, createdAt: now });
    }
    await batch.commit();

    // Re-fetch after seeding
    const seeded = await db.collection('categories').orderBy('createdAt', 'asc').get();
    return NextResponse.json(
      seeded.docs.map(d => ({ id: d.id, ...d.data() }))
    );
  }

  return NextResponse.json(
    snap.docs.map(d => ({ id: d.id, ...d.data() }))
  );
}

export async function POST(req: Request) {
  const { name, emoji } = await req.json();

  if (!name?.trim())  return NextResponse.json({ error: 'name is required' },  { status: 400 });
  if (!emoji?.trim()) return NextResponse.json({ error: 'emoji is required' }, { status: 400 });

  // Duplicate check (case-insensitive)
  const existing = await db.collection('categories')
    .where('name', '==', name.trim())
    .limit(1).get();
  if (!existing.empty)
    return NextResponse.json({ error: 'Category already exists' }, { status: 409 });

  const ref = await db.collection('categories').add({
    name:      name.trim(),
    emoji:     emoji.trim(),
    createdAt: new Date().toISOString(),
  });

  return NextResponse.json({ id: ref.id, name: name.trim(), emoji: emoji.trim() }, { status: 201 });
}