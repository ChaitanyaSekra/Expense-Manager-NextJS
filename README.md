# 🪙 Sekra Budget Tracker — Next.js

A minimal, mobile-first Progressive Web App for tracking shared expenses across up to 5 users. Built with **Next.js 15** (App Router), **React 19**, **TypeScript**, **Firebase Firestore**, and deployed on **Vercel**.

---

## ✨ Features

- Multi-user login with optional 4-digit PIN
- Add / edit / delete expenses and income entries
- **Cash vs Online payment mode** per transaction — with balance split on the home card
- DB-driven categories with emoji, searchable dropdown, quick-add from form
- Manage categories (add / edit / delete) from the profile screen
- Category accordion grouping with net income/expense logic
- Balance, Income, Spent display (always all-time, independent of date filter)
- Range summary line for filtered period (earned / spent)
- 7-day mini bar chart
- Date filtering: All / Today / This Week / This Month / Custom range (defaults to Today)
- PDF export — single user (📄) and all members pooled (👥), with optional detailed view
  - Detailed view shows per-transaction payment mode badges (💵 Cash / ⚡ Online)
  - Summary includes cash balance and online balance split
- PWA installable (manifest + service worker with deploy-based cache busting)
- Dark theme, mobile-first

---

## 🗂️ File Structure

```
sekra/
├── app/
│   ├── layout.tsx
│   ├── globals.css
│   ├── page.tsx                               # Full client-side app (single React component)
│   └── api/
│       ├── users/route.ts                     # GET list users, POST create user
│       ├── users/login/route.ts               # POST login with optional PIN
│       ├── categories/route.ts                # GET all categories, POST new category
│       ├── categories/[id]/route.ts           # PUT edit category, DELETE (guarded)
│       ├── expenses/route.ts                  # POST add expense (includes payment_mode)
│       ├── expenses/[userId]/route.ts         # GET grouped expenses + cash/online splits
│       ├── expenses/[userId]/summary/route.ts # GET 7-day chart data
│       ├── expense/[id]/route.ts              # PUT edit (includes payment_mode), DELETE
│       └── export/pdf/
│           ├── route.ts                       # Single-user printable HTML report
│           └── all/route.ts                   # All-members printable HTML report
├── lib/
│   └── firebase.ts
├── public/
│   ├── manifest.json
│   ├── sw.js                                  # Deploy-version-aware service worker
│   └── icons/
├── next.config.mjs                            # Injects deploy SHA into sw.js at build time
├── package.json
└── tsconfig.json
```

---

## 🔌 API Routes

| Method | Path | Description |
|---|---|---|
| GET | `/api/users` | List all users |
| POST | `/api/users` | Create user `{ name, pin? }` |
| POST | `/api/users/login` | Login `{ name, pin? }` |
| GET | `/api/categories` | List all categories (seeds defaults if empty) |
| POST | `/api/categories` | Add category `{ name, emoji }` |
| PUT | `/api/categories/[id]` | Edit category name/emoji; cascades name change to all expenses |
| DELETE | `/api/categories/[id]` | Delete category — blocked if any expenses use it |
| GET | `/api/expenses/[userId]` | Grouped expenses + cash/online balance splits; supports `?date_from=&date_to=` |
| GET | `/api/expenses/[userId]/summary` | 7-day daily totals for chart |
| POST | `/api/expenses` | Add expense `{ ..., payment_mode: 'cash' \| 'online' }` |
| PUT | `/api/expense/[id]` | Edit expense (payment_mode optional) |
| DELETE | `/api/expense/[id]` | Delete expense |
| GET | `/api/export/pdf` | Printable HTML report (single user) |
| GET | `/api/export/pdf/all` | Printable HTML report (all members pooled) |

---

## 🗄️ Firestore Data Model

```
users/{userId}
  name: string
  pin: string | null
  createdAt: string

categories/{categoryId}
  name: string
  emoji: string
  createdAt: string

expenses/{expenseId}
  userId: string
  amount: number
  type: "expense" | "income"
  category: string          ← category name (string), not ID
  description: string
  date: string (YYYY-MM-DD)
  payment_mode: "cash" | "online"   ← NEW; missing on old records defaults to "cash"
  createdAt: string
```

---

## 💳 Payment Mode

Each transaction is tagged as **Cash** or **Online** at entry time (Cash is the default). Old records without a `payment_mode` field are treated as Cash everywhere.

This affects:
- **Balance card** — a small split row under Income/Spent shows `Cash ₹X` and `Online ₹X` balances
- **Transaction list** — each item shows a small badge (`💵 Cash` / `⚡ Online`) next to the date
- **PDF export** — detailed view shows a badge per transaction row; summary section shows cash and online balance splits

---

## 🌏 IST Date Handling

Applied consistently everywhere (page.tsx, export routes):

```ts
const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const nowIST   = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
```

---

## 🔥 Firestore Composite Indexes Required

| Collection | Fields |
|---|---|
| `expenses` | `userId` ASC, `date` ASC |
| `expenses` | `userId` ASC, `type` ASC, `date` ASC |

(`categories` only uses `createdAt` ASC — auto-created by Firestore)

---

## 🚀 Local Setup

### Requirements
- **Node.js 18+**
- Firebase project with Firestore enabled

### 1. Install dependencies

```bash
npm install
```

### 2. Add environment variables

Create `.env.local`:

```
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
```

### 3. Run dev server

```bash
npm run dev
```

App runs at **http://localhost:3000**

---

## ☁️ Deploy to Vercel

1. Push to GitHub
2. Import the repo on [vercel.com](https://vercel.com)
3. Add the 3 Firebase environment variables in Vercel's project settings
4. Deploy — Next.js is auto-detected, no extra config needed

The service worker uses the Vercel git commit SHA for cache busting (`sekra-{sha}`). On each new deploy all old `sekra-*` caches are automatically cleared. Falls back to a `Date.now()` base-36 string when running locally.

---

## 📄 PDF Export

Generates a print-optimised HTML page that opens in a new tab and auto-triggers the browser print dialog. Select **Save as PDF** in the print dialog.

Both single-user and all-members reports include:
- Summary cards (Income / Expenses / Balance)
- Cash balance and Online balance split
- Category breakdown
- Detailed view (optional): individual rows with date, payment mode badge, and (for all-members) user name pill

---

## 📱 PWA Installation

**Android (Chrome):** Menu → Add to Home Screen  
**iOS (Safari):** Share → Add to Home Screen
