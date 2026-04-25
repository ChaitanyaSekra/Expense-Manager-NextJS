'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface User { id: number; name: string; }
interface Expense { id: number; amount: number; type: 'expense' | 'income'; category: string; description: string; date: string; }
interface ExpenseGroup { category: string; net: number; total: number; _is_income: boolean; expenses: Expense[]; }
interface ExpensesData { groups: ExpenseGroup[]; total_income: number; total_expense: number; balance: number; used_categories: string[]; }
interface ToastItem { id: number; msg: string; type: 'success' | 'error'; }

// ─── Constants ────────────────────────────────────────────────────────────────
const PRESET_CATEGORIES = [
  { name: 'Len-Den', emoji: '🤝' }, { name: 'Transport', emoji: '🚌' },
  { name: 'Food', emoji: '🍽️' },    { name: 'Shopping', emoji: '🛍️' },
  { name: 'Groceries', emoji: '🛒' }, { name: 'Bills', emoji: '💡' },
  { name: 'Entertainment', emoji: '🎉' },
];

// ─── Utilities ────────────────────────────────────────────────────────────────
const initials = (name: string) => name.trim().split(/\s+/).map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
const fmt = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const formatDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const getCategoryIcon = (cat: string) => PRESET_CATEGORIES.find(c => c.name.toLowerCase() === (cat || '').toLowerCase())?.emoji || '📦';

async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
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

function CategoryDropdown({ value, onChange, customCats, onAddCustom }:
  { value: string; onChange: (v: string) => void; customCats: string[]; onAddCustom: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const allCats = [
    ...PRESET_CATEGORIES.map(c => ({ ...c, custom: false })),
    ...customCats.filter(n => !PRESET_CATEGORIES.find(p => p.name === n)).map(n => ({ name: n, emoji: '🏷️', custom: true })),
  ];
  const filtered = query ? allCats.filter(c => c.name.toLowerCase().includes(query.toLowerCase())) : allCats;
  const exactMatch = allCats.some(c => c.name.toLowerCase() === query.toLowerCase());
  const selectedCat = allCats.find(c => c.name === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

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
              <div key={cat.name} className={`cat-option${value === cat.name ? ' selected' : ''}`}
                onClick={() => { onChange(cat.name); setOpen(false); setQuery(''); }}>
                <span className="cat-emoji">{cat.emoji}</span>{cat.name}
              </div>
            ))}
          </div>
          {query && !exactMatch && (
            <div className="cat-add-custom">
              <button onClick={() => { onAddCustom(query); onChange(query); setOpen(false); setQuery(''); }}>
                ＋ Add &quot;{query}&quot;
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]     = useState<'login' | 'dashboard' | 'profile'>('login');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers]       = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [newName, setNewName]   = useState('');
  const [pinBuffer, setPinBuffer] = useState('');
  const [pinModal, setPinModal] = useState<'none' | 'setup' | 'verify'>('none');
  const [pinUser, setPinUser]   = useState<User | null>(null);

  const [expData, setExpData]   = useState<ExpensesData | null>(null);
  const [loading, setLoading]   = useState(false);
  const [chartData, setChartData] = useState<{ date: string; total: number }[]>([]);

  const [dateRange, setDateRange] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo]   = useState('');

  const [expModal, setExpModal] = useState(false);
  const [editId, setEditId]     = useState<number | null>(null);
  const [amount, setAmount]     = useState('');
  const [desc, setDesc]         = useState('');
  const [expDate, setExpDate]   = useState(today());
  const [entryType, setEntryType] = useState<'expense' | 'income'>('expense');
  const [category, setCategory] = useState('');
  const [customCats, setCustomCats] = useState<string[]>([]);

  const [exportModal, setExportModal] = useState(false);
  const [exportMode, setExportMode]   = useState<'month' | 'range'>('month');
  const [exportMonth, setExportMonth] = useState(new Date().getMonth() + 1);
  const [exportYear, setExportYear]   = useState(new Date().getFullYear());
  const [exportFrom, setExportFrom]   = useState('');
  const [exportTo, setExportTo]       = useState('');
  const [exportDetailed, setExportDetailed] = useState(false);

  const [toasts, setToasts]     = useState<ToastItem[]>([]);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [showInstall, setShowInstall]     = useState(false);
  const [offline, setOffline]   = useState(false);
  const toastId = useRef(0);

  const toast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3300);
  }, []);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Service worker
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

    // Offline detection
    const upd = () => setOffline(!navigator.onLine);
    window.addEventListener('online', upd); window.addEventListener('offline', upd); upd();

    // PWA install
    const handler = (e: Event) => {
      e.preventDefault(); setInstallPrompt(e);
      if (!localStorage.getItem('sekra_install_dismissed')) setShowInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => setShowInstall(false));

    // Restore state
    const saved = localStorage.getItem('sekra_user');
    if (saved) { const u = JSON.parse(saved); setCurrentUser(u); setScreen('dashboard'); }
    const cats = localStorage.getItem('sekra_custom_cats');
    if (cats) setCustomCats(JSON.parse(cats));

    loadUsers();
    return () => {
      window.removeEventListener('online', upd); window.removeEventListener('offline', upd);
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  // Load expenses when user / date filter changes
  useEffect(() => {
    if (currentUser && screen === 'dashboard') { loadExpenses(); loadChart(); }
  }, [currentUser, screen, dateRange, filterFrom, filterTo]);

  // ── API helpers ───────────────────────────────────────────────────────────
  const loadUsers = async () => {
    try { setUsers(await apiFetch('/api/users')); } catch {}
  };

  const buildParams = () => {
    const t = today();
    if (dateRange === 'today') return `&date_from=${t}&date_to=${t}`;
    if (dateRange === 'week') {
      const from = new Date(); from.setDate(from.getDate() - from.getDay());
      return `&date_from=${from.toISOString().slice(0,10)}&date_to=${t}`;
    }
    if (dateRange === 'month') {
      const from = new Date(); from.setDate(1);
      return `&date_from=${from.toISOString().slice(0,10)}&date_to=${t}`;
    }
    if (dateRange === 'custom' && filterFrom) {
      return `&date_from=${filterFrom}${filterTo ? `&date_to=${filterTo}` : ''}`;
    }
    return '';
  };

  const loadExpenses = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const data = await apiFetch(`/api/expenses/${currentUser.id}?grouped=true${buildParams()}`);
      setExpData(data);
      if (data.used_categories) {
        setCustomCats((prev: string[]) => {
          const merged = [...prev];
          data.used_categories.forEach((cat: string) => {
            if (!PRESET_CATEGORIES.find(p => p.name === cat) && !merged.includes(cat)) merged.push(cat);
          });
          localStorage.setItem('sekra_custom_cats', JSON.stringify(merged));
          return merged;
        });
      }
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed to load', 'error'); }
    finally { setLoading(false); }
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
    setCurrentUser(null); setSelectedUser(null); setExpData(null);
    setScreen('login'); loadUsers();
  };

  // ── Expense CRUD ──────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditId(null); setAmount(''); setDesc(''); setExpDate(today());
    setEntryType('expense'); setCategory(''); setExpModal(true);
  };

  const openEdit = (exp: Expense) => {
    setEditId(exp.id); setAmount(String(exp.amount)); setDesc(exp.description || '');
    setExpDate(exp.date); setEntryType(exp.type || 'expense'); setCategory(exp.category || '');
    setExpModal(true);
  };

  const saveExpense = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast('Please enter a valid amount', 'error'); return; }
    const cat = category || 'Uncategorized';
    try {
      if (editId) {
        await apiFetch(`/api/expense/${editId}`, { method: 'PUT', body: JSON.stringify({ amount: amt, type: entryType, category: cat, description: desc, date: expDate }) });
        toast('Entry updated ✓');
      } else {
        await apiFetch('/api/expenses', { method: 'POST', body: JSON.stringify({ user_id: currentUser!.id, amount: amt, type: entryType, category: cat, description: desc, date: expDate }) });
        toast('Entry added ✓');
      }
      setExpModal(false); loadExpenses(); loadChart();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Failed to save', 'error'); }
  };

  const deleteExpense = async (id: number) => {
    if (!confirm('Delete this entry?')) return;
    try {
      await apiFetch(`/api/expense/${id}`, { method: 'DELETE' });
      toast('Entry deleted'); loadExpenses(); loadChart();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Delete failed', 'error'); }
  };

  // ── Export PDF ────────────────────────────────────────────────────────────
  const doExport = () => {
    if (!currentUser) return;
    let url = `/api/export/pdf?user_id=${currentUser.id}&detailed=${exportDetailed}`;
    if (exportMode === 'month') {
      url += `&mode=month&month=${exportMonth}&year=${exportYear}`;
    } else {
      if (!exportFrom || !exportTo) { toast('Please select both dates', 'error'); return; }
      if (exportFrom > exportTo) { toast('From date must be before To date', 'error'); return; }
      url += `&mode=range&date_from=${exportFrom}&date_to=${exportTo}`;
    }
    toast('Opening report…'); setExportModal(false);
    window.open(url, '_blank');
  };

  // ── Chart ─────────────────────────────────────────────────────────────────
  const chartDays = (() => {
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const row = chartData.find(r => r.date === key);
      days.push({ key, total: row?.total || 0, isToday: i === 0 });
    }
    return days;
  })();
  const chartMax = Math.max(...chartDays.map(d => d.total), 1);
  const dayNames = ['S','M','T','W','T','F','S'];

  const balance  = expData?.balance      || 0;
  const income   = expData?.total_income  || 0;
  const expense  = expData?.total_expense || 0;
  const count    = (expData?.groups || []).reduce((s, g) => s + g.expenses.length, 0);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* Offline banner */}
      {offline && <div className="offline-banner visible">📡 You&apos;re offline — showing cached data</div>}

      {/* Install banner */}
      {showInstall && (
        <div className="install-banner">
          <div className="install-banner-icon">📱</div>
          <div className="install-banner-text">
            <strong>Install Sekra</strong>
            <span>Add to home screen for quick access</span>
          </div>
          <div className="install-banner-actions">
            <button className="btn-install" onClick={async () => {
              if (!installPrompt) return;
              (installPrompt as BeforeInstallPromptEvent).prompt();
              const { outcome } = await (installPrompt as BeforeInstallPromptEvent).userChoice;
              setInstallPrompt(null); setShowInstall(false);
              if (outcome === 'accepted') toast('App installed! 🎉');
            }}>Install</button>
            <button className="btn-dismiss" onClick={() => { setShowInstall(false); localStorage.setItem('sekra_install_dismissed', '1'); }}>✕</button>
          </div>
        </div>
      )}

      <div className="app-shell">
        {/* ── LOGIN ── */}
        {screen === 'login' && (
          <div className="login-screen">
            <div className="login-logo">
              <h1><span className="logo-accent">Sekra</span></h1>
              <p>Personal budget tracker</p>
            </div>
            <div className="login-card">
              {users.length > 0 && (
                <>
                  <h2>Who&apos;s tracking?</h2>
                  <div className="user-grid">
                    {users.map(u => (
                      <div key={u.id} className={`user-chip${selectedUser?.id === u.id ? ' selected' : ''}`}
                        onClick={() => { setSelectedUser(u); setNewName(''); }}>
                        <div className="chip-avatar">{initials(u.name)}</div>
                        <span className="chip-name">{u.name}</span>
                      </div>
                    ))}
                  </div>
                  <div className="divider">or</div>
                </>
              )}
              <div className="form-group">
                <label>New user</label>
                <input className="form-control" placeholder="Your name…" value={newName}
                  onChange={e => { setNewName(e.target.value); setSelectedUser(null); }} />
              </div>
              {newName.trim() && !selectedUser && (
                <div className="form-group">
                  <label>Set a PIN (optional)</label>
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
                <button className="btn-icon" title="Export PDF" onClick={() => {
                  setExportFrom(new Date(new Date().setDate(1)).toISOString().slice(0,10));
                  setExportTo(today()); setExportModal(true);
                }}>
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                  </svg>
                </button>
                <div className="user-badge" onClick={() => setScreen('profile')}>
                  <div className="user-avatar">{initials(currentUser.name)}</div>
                  <span>{currentUser.name.split(' ')[0]}</span>
                </div>
              </div>
            </div>

            <div className="screen" style={{ animation: 'none', minHeight: 'unset', flex: 1 }}>
              {/* Total card */}
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
              </div>

              {/* Chart */}
              <div className="chart-section">
                <div className="chart-title">Last 7 days · {count} entries</div>
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
                          setFilterTo(today());
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
                        <input type="date" className="form-control" value={filterFrom}
                          onChange={e => setFilterFrom(e.target.value)} />
                      </div>
                      <div className="date-range-sep">—</div>
                      <div className="date-input-wrap">
                        <label>To</label>
                        <input type="date" className="form-control" value={filterTo}
                          onChange={e => setFilterTo(e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Categories */}
              <div className="categories-section">
                {loading ? (
                  <div className="loader"><div className="spinner" /></div>
                ) : !expData?.groups?.length ? (
                  <div className="empty-state">
                    <div className="empty-icon">💸</div>
                    <p>No entries yet.<br />Tap <strong>+</strong> to add your first one.</p>
                  </div>
                ) : (
                  <div className="categories-list">
                    {expData.groups.map(g => <CategoryCard key={g.category} group={g} onEdit={openEdit} onDelete={deleteExpense} />)}
                  </div>
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
                  <div className="stat-value">{count}</div>
                </div>
              </div>
              <div className="profile-actions">
                <button className="btn btn-ghost" onClick={() => { setExportFrom(new Date(new Date().setDate(1)).toISOString().slice(0,10)); setExportTo(today()); setExportModal(true); }}>
                  📄 Export PDF Report
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
      </div>

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
              <CategoryDropdown value={category} onChange={setCategory} customCats={customCats}
                onAddCustom={v => {
                  if (!customCats.includes(v)) {
                    const next = [...customCats, v];
                    setCustomCats(next);
                    localStorage.setItem('sekra_custom_cats', JSON.stringify(next));
                  }
                }} />
            </div>
            <div className="form-group">
              <label>Description</label>
              <input className="form-control" placeholder="What was this for?" value={desc} onChange={e => setDesc(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Date</label>
              <input type="date" className="form-control" value={expDate} onChange={e => setExpDate(e.target.value)} />
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
                    {Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i).map(y =>
                      <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <div className="export-row">
                <div className="form-group">
                  <label>From</label>
                  <input type="date" className="form-control" value={exportFrom} onChange={e => setExportFrom(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>To</label>
                  <input type="date" className="form-control" value={exportTo} onChange={e => setExportTo(e.target.value)} />
                </div>
              </div>
            )}
            <label className="export-checkbox-row">
              <input type="checkbox" checked={exportDetailed} onChange={e => setExportDetailed(e.target.checked)} />
              <div className="export-checkbox-label">
                <span>Detailed view</span>
                <span className="export-checkbox-sub">Include individual transactions inside each category</span>
              </div>
            </label>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={doExport}>
              📄 Generate Report
            </button>
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
            <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
              Welcome back, {pinUser?.name}
            </p>
            <div className="pin-dots" style={{ justifyContent: 'center' }}>
              {[0,1,2,3].map(i => <div key={i} className={`pin-dot${pinBuffer.length > i ? ' filled' : ''}`} />)}
            </div>
            <PinKeypad onKey={handlePinKey} />
          </div>
        </div>
      </div>

      <Toast toasts={toasts} dismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
    </>
  );
}

// ─── Category Card Component ──────────────────────────────────────────────────
function CategoryCard({ group, onEdit, onDelete }: {
  group: ExpenseGroup;
  onEdit: (e: Expense) => void;
  onDelete: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const icon = group._is_income ? '💰' : getCategoryIcon(group.category);

  return (
    <div className={`category-card${group._is_income ? ' income-card' : ''}${expanded ? ' expanded' : ''}`}>
      <div className="category-header" onClick={() => setExpanded(e => !e)}>
        <div className="cat-icon">{icon}</div>
        <div className="cat-info">
          <div className="cat-name">{group.category}</div>
          <div className="cat-count">{group.expenses.length} item{group.expenses.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="cat-total">{group._is_income ? '+' : '-'}₹{fmt(group.total)}</div>
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
                <div className="expense-date">{formatDate(exp.date)}</div>
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

// Type declaration for PWA install prompt
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
