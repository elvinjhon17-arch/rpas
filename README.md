# RBLI RPAS — Performance Appraisal System

Web-based replacement for the Excel RPAS forms. Employees log in with their own
account, rate **themselves only**, and the system computes all scores live using
the same formulas as the paper form. The admin configures each employee's tasks,
weights and formula settings.

**Stack:** React 19 (Vite) · Express 5 (Node.js) · Supabase (free tier) for the
database and avatar storage.

## Features

- **Self-rating only** — every employee has their own login and can rate only themselves
- **Tap-to-rate chips** (10 / 8 / 6 / 4 / 2) instead of typing into Excel cells
- **Auto time-rating** — pick "On time / Delayed / Not done" and the T score fills itself
- **Live score** — APS, EPS, TEPS, WAS and the final adjectival rating update as you tap
- **Auto-save** — every change is saved instantly, no lost work
- **Submit & lock** — once submitted, the appraisal is locked (admin can reopen)
- **Admin panel** — employees, per-employee tasks & weights (with 1.00 weight check),
  Part II critical factors, appraisal periods, formula settings (70/30 split, rating bands),
  submissions dashboard with CSV export
- **Avatars** — every account can upload a profile photo (stored in Supabase Storage)
- **Copy tasks** — admin can copy a task list from another employee/period in one click

## Scoring (same as the Excel form)

| Step | Formula |
|------|---------|
| APS per task | (QN + QL + T) / 3 |
| EPS per task | APS × task weight |
| TEPS | sum of all EPS |
| Part I WAS | TEPS × 70% |
| Part II average | sum of factor ratings ÷ 15 (18 for supervisors) |
| Part II WAS | average × 30% |
| **Overall** | Part I WAS + Part II WAS |

Bands: 9.5+ Outstanding · 8.5 Very Satisfactory · 7.0 Satisfactory · 5.0 Unsatisfactory · below Poor.
All weights and bands are editable in **Admin → Formula Settings**.

## Setup (one time, ~10 minutes)

### 1. Create the Supabase project (free)

1. Go to [supabase.com](https://supabase.com), sign in, **New project** (free plan).
2. When it is ready, open **SQL Editor → New query**, paste the whole contents of
   [`server/sql/schema.sql`](server/sql/schema.sql) and click **Run**.
3. Go to **Project Settings → API** and copy:
   - **Project URL**
   - **service_role key** (under "Project API keys" — keep this secret!)

### 2. Configure the server

```bash
# in the project folder
copy server\.env.example server\.env
```

Edit `server/.env` and paste your Project URL and service_role key. Also change
`JWT_SECRET` to any long random text.

### 3. Install and seed

```bash
npm run install-all
npm run seed              # creates admin account, period, factors, formula settings
# or:  npm run seed -- --sample   (also adds a demo employee with real tasks)
```

Default admin login: **admin / admin123** (or whatever you set in `SEED_ADMIN_PASSWORD`).

### 4. Run

```bash
npm run dev
```

- App: http://localhost:5173
- API: http://localhost:4000

### Production (single server)

```bash
npm run build     # builds client/dist
npm start         # Express serves the API AND the built app on port 4000
```

## First steps as admin

1. Log in as `admin`, change the password in **My Profile**.
2. **Periods** — check the active appraisal period.
3. **Employees** — add each employee (username + password + supervisor flag).
4. **Task Setup** — pick an employee, add their Part I tasks with weights
   (banner turns green when weights total 1.00). Use **Copy from…** to reuse a list.
5. Employees log in, upload an avatar, and fill their self-rating from any device.
6. Watch progress in **Submissions**, export the CSV when the period closes.

## Folder structure

```
server/   Express API (auth, users, tasks, ratings, scoring, avatar upload)
  sql/schema.sql   database schema for the Supabase SQL editor
  scripts/seed.js  seeds admin, period, factors, settings (+ optional demo data)
client/   React app (Vite)
```
