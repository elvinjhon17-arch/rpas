-- RBLI RPAS database schema
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run)

create extension if not exists pgcrypto;

-- Accounts: employees and admins
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  full_name text not null,
  position text default '',
  department text default '',
  role text not null default 'employee' check (role in ('admin', 'employee')),
  is_supervisor boolean not null default false,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Appraisal periods, e.g. "July - December 2026"
-- coverage = how long a period runs (RBLI normally appraises semi-annually)
create table if not exists periods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date,
  end_date date,
  coverage text not null default 'semi_annual' check (coverage in ('monthly', 'quarterly', 'semi_annual', 'annual')),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- Migration for databases created before the coverage column existed
alter table periods add column if not exists coverage text not null default 'semi_annual'
  check (coverage in ('monthly', 'quarterly', 'semi_annual', 'annual'));

-- Part I task rows, configured per employee per period by the admin
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  period_id uuid not null references periods (id) on delete cascade,
  category text not null default 'Duties and Responsibilities',
  code text default '',
  name text not null,
  unit text default '',
  qty_target text default '',
  quality_target text default '1',
  time_target text default 'EOM',
  weight numeric(6, 4) not null default 0.05,
  sort_order int not null default 0
);
create index if not exists tasks_user_period_idx on tasks (user_id, period_id);

-- Employee self-rating per task (1:1 with tasks)
create table if not exists task_ratings (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references tasks (id) on delete cascade,
  qty_accomp text default '',
  quality_accomp text default '',
  time_status text default '' check (time_status in ('', 'COMPLETE', 'DELAYED', 'NOT DONE')),
  rate_qn numeric(5, 2),
  rate_ql numeric(5, 2),
  rate_t numeric(5, 2),
  remarks text default '',
  updated_at timestamptz not null default now()
);

-- Part II critical factors (global list, admin-editable)
create table if not exists factors (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section in ('A', 'B', 'C', 'D')),
  label text not null,
  supervisor_only boolean not null default false,
  sort_order int not null default 0,
  active boolean not null default true
);

-- Employee self-rating per factor per period
create table if not exists factor_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  period_id uuid not null references periods (id) on delete cascade,
  factor_id uuid not null references factors (id) on delete cascade,
  rating numeric(5, 2),
  updated_at timestamptz not null default now(),
  unique (user_id, period_id, factor_id)
);

-- One appraisal record per employee per period (status + comments)
create table if not exists appraisals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  period_id uuid not null references periods (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  comments text default '',
  submitted_at timestamptz,
  unique (user_id, period_id)
);

-- Formula configuration (part weights, rating bands, rating scale)
create table if not exists settings (
  key text primary key,
  value jsonb not null
);
