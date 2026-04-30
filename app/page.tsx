'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface User { id: string; name: string; }
interface Category { id: string; name: string; emoji: string; }
interface Expense { id: string; amount: number; type: 'expense' | 'income'; category: string; description: string; date: string; payment_mode?: 'cash' | 'online'; }
interface ExpenseGroup { category: string; net: number; total: number; _is_income: boolean; expenses: Expense[]; }
interface ExpensesData {
  groups: ExpenseGroup[];
  total_income?: number; total_expense?: number; balance?: number;
  cash_balance?: number; cash_income?: number; cash_expense?: number;
  online_balance?: number; online_income?: number; online_expense?: number;
  used_categories?: string[];
  hasMore?: boolean;
  nextCursor?: string | null;
}
interface AllTimeTotals {
  total_income: number; total_expense: number; balance: number;
  cash_income: number; cash_expense: number; cash_balance: number;
  online_income: number; online_expense: number; online_balance: number;
}
interface ToastItem { id: number; msg: string; type: 'success' | 'error'; }

// ─── Constants ────────────────────────────────────────────────────────────────
const ALL_TIME_CACHE_KEY = 'sekra_alltime_';  // + userId suffix
const ALL_TIME_CACHE_TTL = 5 * 60 * 1000;     // 5 minutes
const CAT_CACHE_KEY      = 'sekra_categories';
const CAT_CACHE_TTL      = 10 * 60 * 1000;    // 10 minutes

// ─── Utilities ────────────────────────────────────────────────────────────────
const initials  = (name: string) => name.trim().split(/\s+/).map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
const fmt       = (n: number)    => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const todayStr  = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const formatDate = (d: string)   => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

async function apiFetch(path: string, options: RequestInit = {}) {
  const res  = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ─── localStorage helpers ─────────────────────────────────────────────────────
function lsGet<T>(key: string, ttl: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, value } = JSON.parse(raw);
    if (Date.now() - ts > ttl) { localStorage.removeItem(key); return null; }
    return value as T;
  } catch { return null; }
}
function lsSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), value })); } catch {}
}
function lsDel(key: string) {
  try { localStorage.removeItem(key); } catch {}
}

// ─── Merge groups helper (for pagination append) ──────────────────────────────
function mergeGroups(existing: ExpensesData | null, incoming: ExpensesData): ExpensesData {
  if (!existing) return incoming;
  const merged = { ...existing, hasMore: incoming.hasMore, nextCursor: incoming.nextCursor };
  const groupMap = new Map(existing.groups.map(g => [g.category, { ...g, expenses: [...g.expenses] }]));
  for (const g of incoming.groups) {
    if (groupMap.has(g.category)) {
      const ex = groupMap.get(g.category)!;
      ex.expenses = [...ex.expenses, ...g.expenses];
      ex.net   = Math.round((ex.net   + g.net)   * 100) / 100;
      ex.total = Math.round((ex.total + g.total)  * 100) / 100;
      ex._is_income = ex.net >= 0;
    } else {
      groupMap.set(g.category, { ...g });
    }
  }
  merged.groups = [...groupMap.values()];
  return merged;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Toast({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`} onClick={() => dismiss(t.id)}>{t.msg}</div>
      ))}
    </div>
  );
}

function PinKeypad({ onKey }: { onKey: (k: string) => void }) {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  return (
    <div className="pin-keypad">
      {keys.map((k, i) => (
        <button key={i} className={`pin-key${k === '⌫' ? ' del' : ''}`}
          style={k === '' ? { visibility: 'hidden' } : {}}
          onClick={() => k && onKey(k)}>{k}</button>
      ))}
    </div>
  );
}

// ─── Category Dropdown ────────────────────────────────────────────────────────
function CategoryDropdown({ value, onChange, categories, onAddNew }:
  { value: string; onChange: (v: string) => void; categories: Category[]; onAddNew: (name: string) => Promise<void> }) {
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState('');
  const [adding, setAdding] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const filtered   = query ? categories.filter(c => c.name.toLowerCase().includes(query.toLowerCase())) : categories;
  const exactMatch = categories.some(c => c.name.toLowerCase() === query.toLowerCase());
  const selectedCat = categories.find(c => c.name === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const handleAddNew = async () => {
    if (!query.trim() || exactMatch || adding) return;
    setAdding(true);
    try { await onAddNew(query.trim()); onChange(query.trim()); setOpen(false); setQuery(''); }
    finally { setAdding(false); }
  };

  return (
    <div className="cat-dropdown-wrap" ref={wrapRef}>
      <div className={`cat-dropdown-trigger${open ? ' open' : ''}`} onClick={() => setOpen(o => !o)}>
        <span style={{ color: value ? 'var(--text)' : undefined }}>
          {selectedCat ? `${selectedCat.emoji} ${selectedCat.name}` : 'Select category…'}
        </span>
        <svg className="cat-chevron-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </div>
      {open && (
        <div className="cat-dropdown-panel">
          <div className="cat-search-wrap">
            <input className="cat-search-input" placeholder="Search or create…" value={query}
              onChange={e => setQuery(e.target.value)} autoFocus />
          </div>
          <div className="cat-dropdown-list">
            {filtered.map(cat => (
              <div key={cat.id} className={`cat-option${value === cat.name ? ' selected' : ''}`}
                onClick={() => { onChange(cat.name); setOpen(false); setQuery(''); }}>
                <span className="cat-emoji">{cat.emoji}</span>{cat.name}
              </div>
            ))}
          </div>
          {query && !exactMatch && (
            <div className="cat-add-custom">
              <button onClick={handleAddNew} disabled={adding}>
                {adding ? '…' : `＋ Add "${query}"`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Manage Categories Modal ──────────────────────────────────────────────────
function ManageCategoriesModal({ open, onClose, categories, onRefresh, toast }:
  { open: boolean; onClose: () => void; categories: Category[]; onRefresh: () => void; toast: (msg: string, type?: 'success' | 'error') => void; }) {
  const COMMON_EMOJIS = ['📦','🏷️','🏠','💊','✈️','🎓','🐾','💪','🎮','📱','🧴','🔧','💰','🎁','🍺','☕','🌿','🚗'];
  const [editId, setEditId]   = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('📦');
  const [saving, setSaving]   = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState<'new' | 'edit' | null>(null);

  useEffect(() => {
    if (!open) { setEditId(null); setShowNewForm(false); setNewName(''); setNewEmoji('📦'); setShowEmojiPicker(null); }
  }, [open]);

  const startEdit  = (cat: Category) => { setEditId(cat.id); setEditName(cat.name); setEditEmoji(cat.emoji); setShowEmojiPicker(null); setShowNewForm(false); };
  const cancelEdit = () => { setEditId(null); setShowEmojiPicker(null); };

  const saveEdit = async () => {
    if (!editId || !editName.trim() || !editEmoji.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`/api/categories/${editId}`, { method: 'PUT', body: JSON.stringify({ name: editName.trim(), emoji: editEmoji.trim() }) });
      toast('Category updated ✓'); setEditId(null); lsDel(CAT_CACHE_KEY); onRefresh();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Update failed', 'error'); }
    finally { setSaving(false); }
  };

  const deleteCategory = async (cat: Category) => {
    if (!confirm(`Delete "${cat.name}"?`)) return;
    setDeleting(cat.id);
    try {
      await apiFetch(`/api/categories/${cat.id}`, { method: 'DELETE' });
      toast('Category deleted'); lsDel(CAT_CACHE_KEY); onRefresh();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Delete failed', 'error'); }
    finally { setDeleting(null); }
  };

  const addNew = async () => {
    if (!newName.trim() || !newEmoji.trim()) return;
    setSaving(true);
    try {
      await apiFetch('/api/categories', { method: 'POST', body: JSON.stringify({ name: newName.trim(), emoji: newEmoji.trim() }) });
      toast('Category added ✓'); setNewName(''); setNewEmoji('📦'); setShowNewForm(false); setShowEmojiPicker(null); lsDel(CAT_CACHE_KEY); onRefresh();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Add failed', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className={`modal-overlay${open ? ' open' : ''}`} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet">
        <div className="modal-handle" />
        <div className="modal-header">
          <div className="modal-title">🏷️ Categories</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="cat-manage-list">
            {categories.map(cat => (
              <div key={cat.id} className="cat-manage-row">
                {editId === cat.id ? (
                  <div className="cat-manage-edit-form">
                    <div className="cat-manage-edit-top">
                      <div className="cat-manage-emoji-wrap">
                        <button className="cat-manage-emoji-btn" onClick={() => setShowEmojiPicker(p => p === 'edit' ? null : 'edit')}>{editEmoji}</button>
                        {showEmojiPicker === 'edit' && (
                          <div className="emoji-picker">
                            {COMMON_EMOJIS.map(e => (
                              <button key={e} className={`emoji-opt${editEmoji === e ? ' active' : ''}`}
                                onClick={() => { setEditEmoji(e); setShowEmojiPicker(null); }}>{e}</button>
                            ))}
                            <input className="emoji-custom-input" placeholder="or type…"
                              onChange={ev => { if (ev.target.value) { setEditEmoji(ev.target.value); setShowEmojiPicker(null); } }} />
                          </div>
                        )}
                      </div>
                      <input className="form-control cat-manage-name-input" value={editName}
                        onChange={e => setEditName(e.target.value)} placeholder="Category name" />
                    </div>
                    <div className="cat-manage-edit-actions">
                      <button className="btn btn-ghost" style={{ flex: 1, padding: '9px' }} onClick={cancelEdit}>Cancel</button>
                      <button className="btn btn-primary" style={{ flex: 1, padding: '9px' }}
                        onClick={saveEdit} disabled={saving || !editName.trim()}>{saving ? '…' : 'Save'}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="cat-manage-info">
                      <span className="cat-manage-emoji">{cat.emoji}</span>
                      <span className="cat-manage-name">{cat.name}</span>
                    </div>
                    <div className="cat-manage-actions">
                      <button className="btn-icon" title="Edit" onClick={() => startEdit(cat)}>
                        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                        </svg>
                      </button>
                      <button className="btn-icon" title="Delete"
                        style={{ color: deleting === cat.id ? 'var(--text-sub)' : 'var(--danger)' }}
                        disabled={deleting === cat.id} onClick={() => deleteCategory(cat)}>
                        {deleting === cat.id
                          ? <div className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />
                          : <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                            </svg>}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          {showNewForm ? (
            <div className="cat-manage-new-form">
              <div className="cat-manage-new-label">New Category</div>
              <div className="cat-manage-edit-top">
                <div className="cat-manage-emoji-wrap">
                  <button className="cat-manage-emoji-btn" onClick={() => setShowEmojiPicker(p => p === 'new' ? null : 'new')}>{newEmoji}</button>
                  {showEmojiPicker === 'new' && (
                    <div className="emoji-picker">
                      {COMMON_EMOJIS.map(e => (
                        <button key={e} className={`emoji-opt${newEmoji === e ? ' active' : ''}`}
                          onClick={() => { setNewEmoji(e); setShowEmojiPicker(null); }}>{e}</button>
                      ))}
                      <input className="emoji-custom-input" placeholder="or type…"
                        onChange={ev => { if (ev.target.value) { setNewEmoji(ev.target.value); setShowEmojiPicker(null); } }} />
                    </div>
                  )}
                </div>
                <input className="form-control cat-manage-name-input" value={newName}
                  onChange={e => setNewName(e.target.value)} placeholder="Category name" autoFocus />
              </div>
              <div className="cat-manage-edit-actions">
                <button className="btn btn-ghost" style={{ flex: 1, padding: '9px' }}
                  onClick={() => { setShowNewForm(false); setNewName(''); setNewEmoji('📦'); setShowEmojiPicker(null); }}>Cancel</button>
                <button className="btn btn-primary" style={{ flex: 1, padding: '9px' }}
                  onClick={addNew} disabled={saving || !newName.trim()}>{saving ? '…' : 'Add'}</button>
              </div>
            </div>
          ) : (
            <button className="cat-manage-add-btn" onClick={() => { setShowNewForm(true); setEditId(null); }}>＋ New Category</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]         = useState<'login' | 'dashboard' | 'profile'>('login');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers]           = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [newName, setNewName]       = useState('');
  const [pinBuffer, setPinBuffer]   = useState('');
  const [pinModal, setPinModal]     = useState<'none' | 'setup' | 'verify'>('none');
  const [pinUser, setPinUser]       = useState<User | null>(null);

  const [expData, setExpData]       = useState<ExpensesData | null>(null);
  const [allTimeTotals, setAllTimeTotals] = useState<AllTimeTotals | null>(null);
  const [loading, setLoading]       = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [chartData, setChartData]   = useState<{ date: string; total: number }[]>([]);

  const [dateRange, setDateRange]   = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('today');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo]     = useState('');

  const [expModal, setExpModal]     = useState(false);
  const [editId, setEditId]         = useState<string | null>(null);
  const [amount, setAmount]         = useState('');
  const [desc, setDesc]             = useState('');
  const [expDate, setExpDate]       = useState(todayStr());
  const [entryType, setEntryType]   = useState<'expense' | 'income'>('expense');
  const [category, setCategory]     = useState('');
  const [paymentMode, setPaymentMode] = useState<'cash' | 'online'>('cash');

  const [categories, setCategories] = useState<Category[]>([]);
  const [catManageOpen, setCatManageOpen] = useState(false);

  const [exportModal, setExportModal]     = useState(false);
  const [exportMode, setExportMode]       = useState<'month' | 'range'>('month');
  const [exportMonth, setExportMonth]     = useState(() => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getMonth() + 1);
  const [exportYear, setExportYear]       = useState(() => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getFullYear());
  const [exportFrom, setExportFrom]       = useState('');
  const [exportTo, setExportTo]           = useState('');
  const [exportDetailed, setExportDetailed] = useState(false);
  const [exportAllModal, setExportAllModal] = useState(false);

  const [toasts, setToasts]         = useState<ToastItem[]>([]);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [showInstall, setShowInstall]     = useState(false);
  const [offline, setOffline]       = useState(false);
  const toastId = useRef(0);

  const toast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3300);
  }, []);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const upd = () => setOffline(!navigator.onLine);
    window.addEventListener('online', upd); window.addEventListener('offline', upd); upd();
    const handler = (e: Event) => {
      e.preventDefault(); setInstallPrompt(e);
      if (!localStorage.getItem('sekra_install_dismissed')) setShowInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => setShowInstall(false));
    const saved = localStorage.getItem('sekra_user');
    if (saved) { const u = JSON.parse(saved); setCurrentUser(u); setScreen('dashboard'); }
    loadUsers();
    loadCategories();
    return () => {
      window.removeEventListener('online', upd); window.removeEventListener('offline', upd);
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  // ── Chart: only when user/screen changes ─────────────────────────────────
  useEffect(() => {
    if (currentUser && screen === 'dashboard') loadChart();
  }, [currentUser, screen]);

  // ── Expenses + totals: re-fetch on filter/user/screen change ─────────────
  useEffect(() => {
    if (currentUser && screen === 'dashboard') {
      setExpData(null); // reset pagination when filter changes
      loadExpenses();
      loadAllTimeTotals();
    }
  }, [currentUser, screen, dateRange, filterFrom, filterTo]);

  // ── API helpers ───────────────────────────────────────────────────────────
  const loadUsers = async () => {
    try { setUsers(await apiFetch('/api/users')); } catch {}
  };

  const loadCategories = async () => {
    const cached = lsGet<Category[]>(CAT_CACHE_KEY, CAT_CACHE_TTL);
    if (cached) {
      setCategories(cached);
      apiFetch('/api/categories').then(data => { setCategories(data); lsSet(CAT_CACHE_KEY, data); }).catch(() => {});
      return;
    }
    try { const data = await apiFetch('/api/categories'); setCategories(data); lsSet(CAT_CACHE_KEY, data); } catch {}
  };

  const getCategoryEmoji = (catName: string) =>
    categories.find(c => c.name.toLowerCase() === catName.toLowerCase())?.emoji || '📦';

  const buildParams = () => {
    const t = todayStr();
    if (dateRange === 'today') return `&date_from=${t}&date_to=${t}`;
    if (dateRange === 'week') {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      nowIST.setDate(nowIST.getDate() - ((nowIST.getDay() + 6) % 7));
      return `&date_from=${nowIST.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}&date_to=${t}`;
    }
    if (dateRange === 'month') {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      return `&date_from=${nowIST.getFullYear()}-${String(nowIST.getMonth() + 1).padStart(2, '0')}-01&date_to=${t}`;
    }
    if (dateRange === 'custom' && filterFrom)
      return `&date_from=${filterFrom}${filterTo ? `&date_to=${filterTo}` : ''}`;
    return '';
  };

  // loadExpenses: paginated in "all" mode, full-fetch in filtered mode
  const loadExpenses = async (append = false) => {
    if (!currentUser) return;
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const isAll = dateRange === 'all';
      const cursorParam = (append && expData?.nextCursor) ? `&cursor=${encodeURIComponent(expData.nextCursor)}` : '';
      const url = `/api/expenses/${currentUser.id}?_=1${buildParams()}${isAll ? `&limit=10${cursorParam}` : ''}`;
      const data: ExpensesData = await apiFetch(url);
      setExpData(prev => append ? mergeGroups(prev, data) : data);
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed to load', 'error'); }
    finally { if (append) setLoadingMore(false); else setLoading(false); }
  };

  // loadAllTimeTotals: single doc read from users/{userId}/totals
  // Cached in localStorage (5 min TTL). Busted after mutations.
  const loadAllTimeTotals = async (bustCache = false) => {
    if (!currentUser) return;
    const cacheKey = ALL_TIME_CACHE_KEY + currentUser.id;
    if (!bustCache) {
      const cached = lsGet<AllTimeTotals>(cacheKey, ALL_TIME_CACHE_TTL);
      if (cached) { setAllTimeTotals(cached); return; }
    }
    try {
      const data: AllTimeTotals = await apiFetch(`/api/users/${currentUser.id}/totals`);
      setAllTimeTotals(data);
      lsSet(cacheKey, data);
    } catch {}
  };

  const loadChart = async () => {
    if (!currentUser) return;
    try { setChartData(await apiFetch(`/api/expenses/${currentUser.id}/summary`)); } catch {}
  };

  // ── Login ─────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    try {
      let user: User;
      if (selectedUser) {
        try {
          user = await apiFetch('/api/users/login', { method: 'POST', body: JSON.stringify({ name: selectedUser.name }) });
        } catch (e: unknown) {
          if (e instanceof Error && e.message.includes('PIN')) { setPinUser(selectedUser); setPinModal('verify'); setPinBuffer(''); return; }
          throw e;
        }
      } else {
        const name = newName.trim();
        if (!name) { toast('Enter your name or select a user', 'error'); return; }
        const pin = pinBuffer.length === 4 ? pinBuffer : null;
        user = await apiFetch('/api/users', { method: 'POST', body: JSON.stringify({ name, pin }) });
      }
      localStorage.setItem('sekra_user', JSON.stringify(user));
      setCurrentUser(user); setPinBuffer(''); setScreen('dashboard');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Login failed', 'error'); }
  };

  const handleVerifyPin = async (pin: string) => {
    if (!pinUser) return;
    try {
      const user: User = await apiFetch('/api/users/login', { method: 'POST', body: JSON.stringify({ name: pinUser.name, pin }) });
      localStorage.setItem('sekra_user', JSON.stringify(user));
      setCurrentUser(user); setPinModal('none'); setPinBuffer(''); setScreen('dashboard');
    } catch { toast('Wrong PIN — try again', 'error'); setPinBuffer(''); }
  };

  const handlePinKey = (k: string) => {
    if (pinModal === 'setup') {
      setPinBuffer(b => k === '⌫' ? b.slice(0, -1) : b.length < 4 ? b + k : b);
    } else {
      const next = k === '⌫' ? pinBuffer.slice(0, -1) : pinBuffer.length < 4 ? pinBuffer + k : pinBuffer;
      setPinBuffer(next);
      if (next.length === 4) handleVerifyPin(next);
    }
  };

  const logout = () => {
    if (!confirm('Switch user?')) return;
    localStorage.removeItem('sekra_user');
    setCurrentUser(null); setSelectedUser(null); setExpData(null); setAllTimeTotals(null);
    setScreen('login'); loadUsers();
  };

  // ── Expense CRUD ──────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditId(null); setAmount(''); setDesc(''); setExpDate(todayStr());
    setEntryType('expense'); setCategory(''); setPaymentMode('cash'); setExpModal(true);
  };

  const openEdit = (exp: Expense) => {
    setEditId(exp.id); setAmount(String(exp.amount)); setDesc(exp.description || '');
    setExpDate(exp.date); setEntryType(exp.type); setCategory(exp.category || '');
    setPaymentMode(exp.payment_mode || 'cash'); setExpModal(true);
  };

  const saveExpense = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast('Please enter a valid amount', 'error'); return; }
    const cat = category || 'Uncategorized';
    try {
      if (editId) {
        await apiFetch(`/api/expense/${editId}`, { method: 'PUT', body: JSON.stringify({ amount: amt, type: entryType, category: cat, description: desc, date: expDate, payment_mode: paymentMode }) });
        toast('Entry updated ✓');
      } else {
        await apiFetch('/api/expenses', { method: 'POST', body: JSON.stringify({ user_id: currentUser!.id, amount: amt, type: entryType, category: cat, description: desc, date: expDate, payment_mode: paymentMode }) });
        toast('Entry added ✓');
      }
      if (currentUser) lsDel(ALL_TIME_CACHE_KEY + currentUser.id);
      setExpModal(false);
      setExpData(null); // reset pagination so the new entry appears at top
      loadExpenses();
      loadAllTimeTotals(true);
      loadChart();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed to save', 'error'); }
  };

  const deleteExpense = async (id: string) => {
    if (!confirm('Delete this entry?')) return;
    try {
      await apiFetch(`/api/expense/${id}`, { method: 'DELETE' });
      toast('Entry deleted');
      if (currentUser) lsDel(ALL_TIME_CACHE_KEY + currentUser.id);
      setExpData(null);
      loadExpenses();
      loadAllTimeTotals(true);
      loadChart();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Delete failed', 'error'); }
  };

  const handleAddCategoryFromDropdown = async (name: string) => {
    await apiFetch('/api/categories', { method: 'POST', body: JSON.stringify({ name: name.trim(), emoji: '📦' }) });
    lsDel(CAT_CACHE_KEY);
    await loadCategories();
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const doExport = () => {
    if (!currentUser) return;
    let url = `/api/export/pdf?user_id=${currentUser.id}&detailed=${exportDetailed}`;
    if (exportMode === 'month') url += `&mode=month&month=${exportMonth}&year=${exportYear}`;
    else {
      if (!exportFrom || !exportTo) { toast('Please select both dates', 'error'); return; }
      if (exportFrom > exportTo) { toast('From date must be before To date', 'error'); return; }
      url += `&mode=range&date_from=${exportFrom}&date_to=${exportTo}`;
    }
    toast('Opening report…'); setExportModal(false); window.open(url, '_blank');
  };

  const doExportAll = () => {
    let url = `/api/export/pdf/all?detailed=${exportDetailed}`;
    if (exportMode === 'month') url += `&mode=month&month=${String(exportMonth).padStart(2, '0')}&year=${exportYear}`;
    else {
      if (!exportFrom || !exportTo) { toast('Please select both dates', 'error'); return; }
      if (exportFrom > exportTo) { toast('From date must be before To date', 'error'); return; }
      url += `&mode=range&date_from=${exportFrom}&date_to=${exportTo}`;
    }
    toast('Opening all-members report…'); setExportAllModal(false); window.open(url, '_blank');
  };

  // ── Chart ─────────────────────────────────────────────────────────────────
  const chartDays = (() => {
    const days = [];
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    for (let i = 6; i >= 0; i--) {
      const d = new Date(nowIST); d.setDate(d.getDate() - i);
      const key   = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const found = chartData.find(x => x.date === key);
      days.push({ key, total: found?.total ?? 0, isToday: i === 0 });
    }
    return days;
  })();
  const chartMax  = Math.max(...chartDays.map(d => d.total), 1);
  const dayNames  = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  // ── Derived values ────────────────────────────────────────────────────────
  const balance = allTimeTotals?.balance       ?? 0;
  const income  = allTimeTotals?.total_income  ?? 0;
  const expense = allTimeTotals?.total_expense ?? 0;
  // For filtered views, range totals come from expData (which does full fetch)
  const rangedIncome  = expData?.total_income  ?? 0;
  const rangedExpense = expData?.total_expense ?? 0;
  const count = allTimeTotals
    ? undefined // entry count comes from chart data when totals are from user doc
    : expData?.groups?.reduce((s, g) => s + g.expenses.length, 0) ?? 0;
  const chartCount = chartData.reduce((s, d) => s + (d.total > 0 ? 1 : 0), 0);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="app-shell">

        {/* ── LOGIN ── */}
        {screen === 'login' && (
          <div className="login-screen">
            <div className="login-logo">
              <h1>Sekra</h1>
              <p>Your personal budget tracker</p>
            </div>

            {offline && <div className="offline-banner">📡 You&apos;re offline</div>}

            {showInstall && (
              <div className="install-banner">
                <span>Add Sekra to your home screen</span>
                <div className="install-banner-actions">
                  <button className="btn btn-primary btn-sm" onClick={async () => {
                    if (installPrompt) {
                      (installPrompt as BeforeInstallPromptEvent).prompt();
                      const { outcome } = await (installPrompt as BeforeInstallPromptEvent).userChoice;
                      if (outcome === 'accepted') setShowInstall(false);
                    }
                  }}>Install</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setShowInstall(false); localStorage.setItem('sekra_install_dismissed', '1'); }}>Later</button>
                </div>
              </div>
            )}

            <div className="login-card">
              {users.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
                  {users.map(u => (
                    <button key={u.id}
                      className={`user-chip${selectedUser?.id === u.id ? ' selected' : ''}`}
                      onClick={() => { setSelectedUser(s => s?.id === u.id ? null : u); setNewName(''); setPinBuffer(''); }}>
                      <div className="chip-avatar">{initials(u.name)}</div>
                      <span className="chip-name">{u.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {users.length > 0 && <div className="divider"><span>or create new</span></div>}
              <div className="form-group">
                <label>Your name</label>
                <input className="form-control" placeholder="Enter your name" value={newName}
                  onChange={e => { setNewName(e.target.value); if (e.target.value) setSelectedUser(null); }} />
              </div>
              {newName.trim().length > 0 && (
                <div className="form-group">
                  <label>PIN (optional)</label>
                  <div className="pin-dots">
                    {[0,1,2,3].map(i => <div key={i} className={`pin-dot${pinBuffer.length > i ? ' filled' : ''}`} />)}
                  </div>
                  <PinKeypad onKey={k => {
                    if (k === '⌫') setPinBuffer(b => b.slice(0, -1));
                    else if (pinBuffer.length < 4) setPinBuffer(b => b + k);
                  }} />
                </div>
              )}
              <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={handleLogin}>
                {selectedUser ? `Continue as ${selectedUser.name}` : 'Get Started'}
              </button>
            </div>
          </div>
        )}

        {/* ── DASHBOARD ── */}
        {screen === 'dashboard' && currentUser && (
          <>
            <div className="app-header">
              <h1>Sekra</h1>
              <div className="header-meta">
                <button className="btn-icon" title="Export My PDF" onClick={() => {
                  setExportFrom(new Date(new Date().setDate(1)).toISOString().slice(0,10));
                  setExportTo(todayStr()); setExportModal(true);
                }}>
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                  </svg>
                </button>
                <button className="btn-icon" title="Export All Members PDF" onClick={() => {
                  setExportFrom(new Date(new Date().setDate(1)).toISOString().slice(0,10));
                  setExportTo(todayStr()); setExportAllModal(true);
                }}>
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
                  </svg>
                </button>
                <div className="user-badge" onClick={() => setScreen('profile')}>
                  <div className="user-avatar">{initials(currentUser.name)}</div>
                  <span>{currentUser.name.split(' ')[0]}</span>
                </div>
              </div>
            </div>

            <div className="screen" style={{ animation: 'none', minHeight: 'unset', flex: 1 }}>
              {/* Balance card — always all-time from user doc */}
              <div className="total-card">
                <div className="total-label">Balance</div>
                <div className="total-amount">
                  <span className="currency-sym">{balance < 0 ? '-₹' : '₹'}</span>
                  <span className={`balance-amount${balance >= 0 ? ' positive' : ' negative'}`}>
                    {fmt(Math.abs(balance))}
                  </span>
                </div>
                <div className="balance-sub-row" style={{ marginBottom: 0 }}>
                  <div className="balance-sub">
                    <div className="balance-sub-icon income-icon">↑</div>
                    <div><div className="balance-sub-label">Income</div><div className="balance-sub-val">₹{fmt(income)}</div></div>
                  </div>
                  <div className="balance-sub-divider" />
                  <div className="balance-sub">
                    <div className="balance-sub-icon expense-icon">↓</div>
                    <div><div className="balance-sub-label">Spent</div><div className="balance-sub-val">₹{fmt(expense)}</div></div>
                  </div>
                </div>
                <div className="pay-split-row">
                  <div className="pay-split-item">
                    <span className="pay-split-dot cash-dot" />
                    <span className="pay-split-label">Cash</span>
                    <span className={`pay-split-val${(allTimeTotals?.cash_balance ?? 0) < 0 ? ' neg' : ''}`}>
                      {(allTimeTotals?.cash_balance ?? 0) < 0 ? '-' : ''}₹{fmt(Math.abs(allTimeTotals?.cash_balance ?? 0))}
                    </span>
                  </div>
                  <div className="pay-split-sep" />
                  <div className="pay-split-item">
                    <span className="pay-split-dot online-dot" />
                    <span className="pay-split-label">Online</span>
                    <span className={`pay-split-val${(allTimeTotals?.online_balance ?? 0) < 0 ? ' neg' : ''}`}>
                      {(allTimeTotals?.online_balance ?? 0) < 0 ? '-' : ''}₹{fmt(Math.abs(allTimeTotals?.online_balance ?? 0))}
                    </span>
                  </div>
                </div>
              </div>

              {/* Chart */}
              <div className="chart-section">
                <div className="chart-title">Last 7 days · {chartCount} active days</div>
                <div className="mini-chart">
                  {chartDays.map(d => (
                    <div key={d.key} className="chart-bar-wrap">
                      <div className={`chart-bar${d.isToday ? ' today' : ''}`}
                        style={{ height: `${Math.max((d.total / chartMax) * 100, 4)}%` }} />
                      <div className="chart-day">{d.isToday ? '•' : dayNames[new Date(d.key + 'T00:00:00').getDay()]}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Date filter */}
              <div className="date-filter">
                <div className="date-filter-pills">
                  {(['all', 'today', 'week', 'month', 'custom'] as const).map(r => (
                    <button key={r} className={`filter-pill${dateRange === r ? ' active' : ''}`}
                      onClick={() => {
                        setDateRange(r);
                        if (r !== 'custom') { setFilterFrom(''); setFilterTo(''); }
                        else if (!filterFrom) {
                          const from = new Date(); from.setDate(1);
                          setFilterFrom(from.toISOString().slice(0,10));
                          setFilterTo(todayStr());
                        }
                      }}>
                      {r === 'all' ? 'All time' : r.charAt(0).toUpperCase() + r.slice(1)}
                    </button>
                  ))}
                </div>
                {dateRange === 'custom' && (
                  <div className="date-filter-custom">
                    <div className="date-filter-inputs">
                      <div className="date-input-wrap">
                        <label>From</label>
                        <input type="date" className="form-control" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
                      </div>
                      <div className="date-range-sep">—</div>
                      <div className="date-input-wrap">
                        <label>To</label>
                        <input type="date" className="form-control" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Range summary */}
              {dateRange !== 'all' && expData && (
                <div className="range-summary">
                  <span className="range-income">↑ ₹{fmt(rangedIncome)} earned</span>
                  <span className="range-dot">·</span>
                  <span className="range-expense">↓ ₹{fmt(rangedExpense)} spent</span>
                </div>
              )}

              {/* Transaction list */}
              <div className="categories-section">
                {loading ? (
                  <div className="loader"><div className="spinner" /></div>
                ) : !expData?.groups?.length ? (
                  <div className="empty-state">
                    <div className="empty-icon">💸</div>
                    <p>No entries yet.<br />Tap <strong>+</strong> to add your first one.</p>
                  </div>
                ) : (
                  <>
                    <div className="categories-list">
                      {expData.groups.map(g => (
                        <CategoryCard
                          key={g.category}
                          group={g}
                          getCategoryEmoji={getCategoryEmoji}
                          onEdit={openEdit}
                          onDelete={deleteExpense}
                        />
                      ))}
                    </div>

                    {/* Load more — only shown in All time mode */}
                    {dateRange === 'all' && expData.hasMore && (
                      <button
                        className="btn btn-ghost"
                        style={{ width: '100%', marginTop: 12, padding: '12px' }}
                        onClick={() => loadExpenses(true)}
                        disabled={loadingMore}>
                        {loadingMore
                          ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2, display: 'inline-block', marginRight: 8 }} />Loading…</>
                          : 'Load 10 more'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Bottom nav */}
            <nav className="bottom-nav">
              <button className="nav-item active">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
                </svg>
                <span>Home</span>
              </button>
              <button className="fab" onClick={openAdd}>+</button>
              <button className="nav-item" onClick={() => setScreen('profile')}>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                </svg>
                <span>Profile</span>
              </button>
            </nav>
          </>
        )}

        {/* ── PROFILE ── */}
        {screen === 'profile' && currentUser && (
          <>
            <div className="profile-screen" style={{ minHeight: '100dvh' }}>
              <button className="btn-icon" style={{ alignSelf: 'flex-start', marginBottom: 8 }} onClick={() => setScreen('dashboard')}>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
                </svg>
              </button>
              <div className="profile-hero">
                <div className="profile-avatar-lg">{initials(currentUser.name)}</div>
                <div className="profile-name">{currentUser.name}</div>
              </div>
              <div className="profile-stats">
                <div className="stat-card">
                  <div className="stat-label">Balance</div>
                  <div className="stat-value" style={{ color: balance >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {balance < 0 ? '-' : ''}₹{fmt(Math.abs(balance))}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Entries</div>
                  <div className="stat-value">{count ?? '—'}</div>
                </div>
              </div>
              <div className="profile-actions">
                <button className="btn btn-ghost" onClick={() => { setExportFrom(new Date(new Date().setDate(1)).toISOString().slice(0,10)); setExportTo(todayStr()); setExportModal(true); }}>
                  📄 Export My Report
                </button>
                <button className="btn btn-ghost" onClick={() => { setExportFrom(new Date(new Date().setDate(1)).toISOString().slice(0,10)); setExportTo(todayStr()); setExportAllModal(true); }}>
                  👥 Export All Members
                </button>
                <button className="btn btn-ghost profile-cat-btn" onClick={() => setCatManageOpen(true)}>
                  <span className="profile-cat-btn-left">
                    <span className="profile-cat-emoji-strip">
                      {categories.slice(0, 4).map(c => <span key={c.id}>{c.emoji}</span>)}
                    </span>
                    Manage Categories
                  </span>
                  <span className="profile-cat-count">{categories.length}</span>
                </button>
                <button className="btn btn-danger" style={{ width: '100%' }} onClick={logout}>Switch User</button>
              </div>
            </div>
            <nav className="bottom-nav">
              <button className="nav-item" onClick={() => setScreen('dashboard')}>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
                </svg>
                <span>Home</span>
              </button>
              <button className="fab" onClick={openAdd}>+</button>
              <button className="nav-item active">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                </svg>
                <span>Profile</span>
              </button>
            </nav>
          </>
        )}

      </div>{/* end app-shell */}

      {/* ── EXPENSE MODAL ── */}
      <div className={`modal-overlay${expModal ? ' open' : ''}`} onClick={e => { if (e.target === e.currentTarget) setExpModal(false); }}>
        <div className="modal-sheet">
          <div className="modal-handle" />
          <div className="modal-header">
            <div className="modal-title">{editId ? 'Edit Entry' : 'Add Entry'}</div>
            <button className="modal-close" onClick={() => setExpModal(false)}>✕</button>
          </div>
          <div className="modal-body">
            <div className="type-toggle">
              <button className={`type-btn expense-btn${entryType === 'expense' ? ' active' : ''}`} onClick={() => setEntryType('expense')}>
                <span className="type-btn-icon">−</span> Expense
              </button>
              <button className={`type-btn income-btn${entryType === 'income' ? ' active' : ''}`} onClick={() => setEntryType('income')}>
                <span className="type-btn-icon">+</span> Income
              </button>
            </div>
            <div className="form-group">
              <label>Amount (₹)</label>
              <input className="form-control" type="number" inputMode="decimal" placeholder="0.00"
                value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Category</label>
              <CategoryDropdown value={category} onChange={setCategory} categories={categories} onAddNew={handleAddCategoryFromDropdown} />
            </div>
            <div className="form-group">
              <label>Description</label>
              <input className="form-control" placeholder="What was this for?" value={desc} onChange={e => setDesc(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Date</label>
              <input type="date" className="form-control" value={expDate} onChange={e => setExpDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Payment Mode</label>
              <div className="pay-mode-toggle">
                <button className={`pay-mode-btn${paymentMode === 'cash' ? ' active cash' : ''}`} onClick={() => setPaymentMode('cash')}>💵 Cash</button>
                <button className={`pay-mode-btn${paymentMode === 'online' ? ' active online' : ''}`} onClick={() => setPaymentMode('online')}>⚡ Online</button>
              </div>
            </div>
            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={saveExpense}>
              {editId ? 'Update Entry' : 'Save Entry'}
            </button>
          </div>
        </div>
      </div>

      {/* ── EXPORT MODAL ── */}
      <div className={`modal-overlay${exportModal ? ' open' : ''}`} onClick={e => { if (e.target === e.currentTarget) setExportModal(false); }}>
        <div className="modal-sheet">
          <div className="modal-handle" />
          <div className="modal-header">
            <div className="modal-title">Export Report</div>
            <button className="modal-close" onClick={() => setExportModal(false)}>✕</button>
          </div>
          <div className="modal-body">
            <div className="export-toggle">
              <button className={exportMode === 'month' ? 'active' : ''} onClick={() => setExportMode('month')}>By Month</button>
              <button className={exportMode === 'range' ? 'active' : ''} onClick={() => setExportMode('range')}>Date Range</button>
            </div>
            {exportMode === 'month' ? (
              <div className="export-row">
                <div className="form-group">
                  <label>Month</label>
                  <select className="form-control" value={exportMonth} onChange={e => setExportMonth(Number(e.target.value))}>
                    {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) =>
                      <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Year</label>
                  <select className="form-control" value={exportYear} onChange={e => setExportYear(Number(e.target.value))}>
                    {Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <div className="export-row">
                <div className="form-group"><label>From</label><input type="date" className="form-control" value={exportFrom} onChange={e => setExportFrom(e.target.value)} /></div>
                <div className="form-group"><label>To</label><input type="date" className="form-control" value={exportTo} onChange={e => setExportTo(e.target.value)} /></div>
              </div>
            )}
            <label className="export-checkbox-row">
              <input type="checkbox" checked={exportDetailed} onChange={e => setExportDetailed(e.target.checked)} />
              <div className="export-checkbox-label">
                <span>Detailed view</span>
                <span className="export-checkbox-sub">Include individual transactions inside each category</span>
              </div>
            </label>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={doExport}>📄 Generate Report</button>
          </div>
        </div>
      </div>

      {/* ── EXPORT ALL MEMBERS MODAL ── */}
      <div className={`modal-overlay${exportAllModal ? ' open' : ''}`} onClick={e => { if (e.target === e.currentTarget) setExportAllModal(false); }}>
        <div className="modal-sheet">
          <div className="modal-handle" />
          <div className="modal-header">
            <div className="modal-title">👥 All Members Report</div>
            <button className="modal-close" onClick={() => setExportAllModal(false)}>✕</button>
          </div>
          <div className="modal-body">
            <div className="export-toggle">
              <button className={exportMode === 'month' ? 'active' : ''} onClick={() => setExportMode('month')}>By Month</button>
              <button className={exportMode === 'range' ? 'active' : ''} onClick={() => setExportMode('range')}>Date Range</button>
            </div>
            {exportMode === 'month' ? (
              <div className="export-row">
                <div className="form-group">
                  <label>Month</label>
                  <select className="form-control" value={exportMonth} onChange={e => setExportMonth(Number(e.target.value))}>
                    {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) =>
                      <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Year</label>
                  <select className="form-control" value={exportYear} onChange={e => setExportYear(Number(e.target.value))}>
                    {Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <div className="export-row">
                <div className="form-group"><label>From</label><input type="date" className="form-control" value={exportFrom} onChange={e => setExportFrom(e.target.value)} /></div>
                <div className="form-group"><label>To</label><input type="date" className="form-control" value={exportTo} onChange={e => setExportTo(e.target.value)} /></div>
              </div>
            )}
            <label className="export-checkbox-row">
              <input type="checkbox" checked={exportDetailed} onChange={e => setExportDetailed(e.target.checked)} />
              <div className="export-checkbox-label">
                <span>Detailed view</span>
                <span className="export-checkbox-sub">Include individual transactions inside each category</span>
              </div>
            </label>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={doExportAll}>👥 Generate All Members Report</button>
          </div>
        </div>
      </div>

      {/* ── PIN VERIFY MODAL ── */}
      <div className={`modal-overlay${pinModal === 'verify' ? ' open' : ''}`}>
        <div className="modal-sheet">
          <div className="modal-handle" />
          <div className="modal-header">
            <div className="modal-title">Enter PIN</div>
            <button className="modal-close" onClick={() => { setPinModal('none'); setPinBuffer(''); }}>✕</button>
          </div>
          <div className="modal-body" style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>Welcome back, {pinUser?.name}</p>
            <div className="pin-dots" style={{ justifyContent: 'center' }}>
              {[0,1,2,3].map(i => <div key={i} className={`pin-dot${pinBuffer.length > i ? ' filled' : ''}`} />)}
            </div>
            <PinKeypad onKey={handlePinKey} />
          </div>
        </div>
      </div>

      {/* ── MANAGE CATEGORIES MODAL ── */}
      <ManageCategoriesModal open={catManageOpen} onClose={() => setCatManageOpen(false)}
        categories={categories} onRefresh={loadCategories} toast={toast} />

      <Toast toasts={toasts} dismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
    </>
  );
}

// ─── Category Card ────────────────────────────────────────────────────────────
function CategoryCard({ group, getCategoryEmoji, onEdit, onDelete }: {
  group: ExpenseGroup;
  getCategoryEmoji: (name: string) => string;
  onEdit: (e: Expense) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const icon = getCategoryEmoji(group.category);

  return (
    <div className={`category-card${group._is_income ? ' income-card' : ''}${expanded ? ' expanded' : ''}`}>
      <div className="category-header" onClick={() => setExpanded(e => !e)}>
        <div className="cat-icon">{icon}</div>
        <div className="cat-info">
          <div className="cat-name">{group.category}</div>
          <div className="cat-count">{group.expenses.length} item{group.expenses.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="cat-total">{group.net >= 0 ? '+' : '-'}₹{fmt(Math.abs(group.net))}</div>
        <svg className="cat-chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </div>
      <div className="expense-list">
        <div className="expense-list-inner">
          {group.expenses.map(exp => (
            <div key={exp.id} className="expense-item">
              <div className="expense-dot" />
              <div className="expense-info">
                <div className="expense-desc">{exp.description || '—'}</div>
                <div className="expense-date">
                  {formatDate(exp.date)}
                  <span className={`expense-pay-badge ${exp.payment_mode || 'cash'}`}>
                    {(exp.payment_mode || 'cash') === 'online' ? '⚡ Online' : '💵 Cash'}
                  </span>
                </div>
              </div>
              <div className={`expense-amount ${exp.type}`}>
                {exp.type === 'income' ? '+' : '-'}₹{fmt(exp.amount)}
              </div>
              <div className="expense-actions">
                <button className="btn-icon" title="Edit" onClick={() => onEdit(exp)}>
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                  </svg>
                </button>
                <button className="btn-icon" title="Delete" style={{ color: 'var(--danger)' }} onClick={() => onDelete(exp.id)}>
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}