# 🪙 Sekra Budget Tracker — Next.js

A minimal, mobile-first Progressive Web App for tracking personal expenses. Migrated from Flask + vanilla JS to **Next.js 15** with the App Router.

---

## ✨ What's new vs the Flask version

| | Flask original | Next.js version |
|---|---|---|
| Backend | Python Flask | Next.js API Routes (TypeScript) |
| Database | SQLite via Python | SQLite via Node.js v22 built-in `node:sqlite` |
| Frontend | Vanilla JS | React 18 (client components) |
| PDF Export | ReportLab (Python) | Print-optimised HTML → browser print-to-PDF |
| Styling | Same dark theme CSS | Identical CSS, imported as global styles |

All features are preserved: multi-user login, PIN protection, category accordion, income/expense tracking, date filters, 7-day mini chart, and PDF export.

---

## 🚀 Local Setup

### Requirements
- **Node.js v22+** (uses built-in `node:sqlite`, no extra packages needed)
- No Python required

### 1. Install dependencies

```bash
npm install
```

### 2. Run dev server

```bash
npm run dev
```

App runs at **http://localhost:3000**

### 3. Build for production

```bash
npm run build
npm start
```

---

## ☁️ Deploy to Render

1. Push to GitHub.
2. Create a new **Web Service** on [render.com](https://render.com).
3. Set:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
4. Add environment variable: `DB_PATH=/data/budget.db`
5. Add a **Disk** mounted at `/data` (1 GB).

---

## 📁 File Structure

```
sekra/
├── app/
│   ├── layout.tsx              # Root layout
│   ├── globals.css             # Dark theme styles (identical to original)
│   ├── page.tsx                # Full client-side app (React)
│   └── api/
│       ├── users/route.ts          # GET/POST users
│       ├── users/login/route.ts    # POST login
│       ├── expenses/route.ts       # POST add expense
│       ├── expenses/[userId]/route.ts       # GET expenses (grouped)
│       ├── expenses/[userId]/summary/route.ts  # GET 7-day chart data
│       ├── expense/[id]/route.ts   # PUT/DELETE single expense
│       └── export/pdf/route.ts     # GET printable HTML report
├── lib/
│   └── db.ts                   # SQLite singleton (node:sqlite)
├── public/
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
│       └── icon.svg
├── generate_icons.mjs          # SVG icon generator
├── next.config.mjs
├── tsconfig.json
└── package.json
```

---

## 🔌 API Endpoints (unchanged from Flask)

| Method | Path | Description |
|---|---|---|
| GET  | `/api/users` | List all users |
| POST | `/api/users` | Create user |
| POST | `/api/users/login` | Login with optional PIN |
| GET  | `/api/expenses/:userId` | Get grouped expenses |
| GET  | `/api/expenses/:userId/summary` | 7-day chart data |
| POST | `/api/expenses` | Add expense |
| PUT  | `/api/expense/:id` | Edit expense |
| DELETE | `/api/expense/:id` | Delete expense |
| GET  | `/api/export/pdf` | Printable HTML report |

---

## 📄 PDF Export

The Flask version used **ReportLab** (Python) to generate PDFs server-side.

The Next.js version generates a **print-optimised HTML page** that opens in a new tab and auto-triggers the browser's print dialog. Select "Save as PDF" in the print dialog for a clean, styled PDF. This approach works on all devices including mobile.

---

## 🗄️ Database Reset

```bash
# Using SQLite CLI
sqlite3 budget.db "DELETE FROM expenses; DELETE FROM users; DELETE FROM sqlite_sequence;"

# Also clear browser localStorage:
# localStorage.removeItem('sekra_custom_cats')
# localStorage.removeItem('sekra_user')
```

---

## 📱 PWA Installation

Same as before — the `manifest.json` and `sw.js` are served from `/public`.

**Android (Chrome):** Menu → Add to Home Screen  
**iOS (Safari):** Share → Add to Home Screen

For proper app icons, generate PNG files from `public/icons/icon.svg` and place them at:
- `public/icons/icon-192.png`
- `public/icons/icon-512.png`
