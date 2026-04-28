import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { name, emoji } = await req.json();

  if (!name?.trim())  return NextResponse.json({ error: 'name is required' },  { status: 400 });
  if (!emoji?.trim()) return NextResponse.json({ error: 'emoji is required' }, { status: 400 });

  const ref = db.collection('categories').doc(id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: 'Category not found' }, { status: 404 });

  // Duplicate name check (excluding self)
  const existing = await db.collection('categories')
    .where('name', '==', name.trim())
    .limit(1).get();
  if (!existing.empty && existing.docs[0].id !== id)
    return NextResponse.json({ error: 'Another category with that name already exists' }, { status: 409 });

  const oldName = doc.data()?.name as string;
  await ref.update({ name: name.trim(), emoji: emoji.trim() });

  // If the name changed, update all expenses that reference the old name
  if (oldName !== name.trim()) {
    const expSnap = await db.collection('expenses')
      .where('category', '==', oldName).get();

    if (!expSnap.empty) {
      const batch = db.batch();
      expSnap.docs.forEach(d => batch.update(d.ref, { category: name.trim() }));
      await batch.commit();
    }
  }

  return NextResponse.json({ id, name: name.trim(), emoji: emoji.trim() });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const ref = db.collection('categories').doc(id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: 'Category not found' }, { status: 404 });

  const catName = doc.data()?.name as string;

  // Block deletion if any expense uses this category
  const expSnap = await db.collection('expenses')
    .where('category', '==', catName).limit(1).get();

  if (!expSnap.empty)
    return NextResponse.json(
      { error: `Cannot delete — expenses exist under "${catName}". Remove or reassign them first.` },
      { status: 409 }
    );

  await ref.delete();
  return NextResponse.json({ deleted: true });
}