-- RBLI RPAS database schema
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run)

create extension if not exists pgcrypto;

-- Accounts: employees and admins
-- rater_privilege: what an account may rate when assigned as someone's rater
--   none  - regular employee (only their own Page 3 self rate)
--   page3 - may be assigned as HR / Peer / Audit rater (enters one overall score)
--   full  - department officer/head; may be assigned as Supervisor (fills Pages 1-3)
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  full_name text not null,
  position text default '',
  department text default '',
  role text not null default 'employee' check (role in ('admin', 'employee')),
  is_supervisor boolean not null default false,
  rater_privilege text not null default 'none' check (rater_privilege in ('none', 'page3', 'full')),
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

-- Task rating per rater (self, supervisor, peer, hr, audit - see Page 3 (new) of the form)
create table if not exists task_ratings (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  rater_type text not null default 'self' check (rater_type in ('self', 'supervisor', 'peer', 'hr', 'audit')),
  qty_accomp text default '',
  quality_accomp text default '',
  time_status text default '' check (time_status in ('', 'COMPLETE', 'DELAYED', 'NOT DONE')),
  rate_qn numeric(5, 2),
  rate_ql numeric(5, 2),
  rate_t numeric(5, 2),
  remarks text default '',
  updated_at timestamptz not null default now(),
  unique (task_id, rater_type)
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

-- Factor rating per rater per period
create table if not exists factor_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  period_id uuid not null references periods (id) on delete cascade,
  factor_id uuid not null references factors (id) on delete cascade,
  rater_type text not null default 'self' check (rater_type in ('self', 'supervisor', 'peer', 'hr', 'audit')),
  rating numeric(5, 2),
  updated_at timestamptz not null default now(),
  unique (user_id, period_id, factor_id, rater_type)
);

-- One appraisal record per employee per period per rater (status + comments).
-- overall_score: Page 3 direct score for self/hr/peer/audit raters (the
-- supervisor's score is computed from their Part I/II form instead).
create table if not exists appraisals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  period_id uuid not null references periods (id) on delete cascade,
  rater_type text not null default 'self' check (rater_type in ('self', 'supervisor', 'peer', 'hr', 'audit')),
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  overall_score numeric(5, 2),
  comments text default '',
  submitted_at timestamptz,
  unique (user_id, period_id, rater_type)
);

-- Who rates whom: the admin assigns a supervisor/peer/hr/audit rater per employee
-- (self needs no assignment - every employee rates themselves)
create table if not exists rater_assignments (
  id uuid primary key default gen_random_uuid(),
  ratee_id uuid not null references users (id) on delete cascade,
  rater_type text not null check (rater_type in ('supervisor', 'peer', 'hr', 'audit')),
  rater_user_id uuid not null references users (id) on delete cascade,
  unique (ratee_id, rater_type)
);

-- Formula configuration (part weights, rating bands, rating scale, rater weights)
create table if not exists settings (
  key text primary key,
  value jsonb not null
);

-- ============================================================
-- Migration for databases created before the multi-rater update
-- (safe to run repeatedly - all statements are idempotent)
-- ============================================================
alter table task_ratings add column if not exists rater_type text not null default 'self'
  check (rater_type in ('self', 'supervisor', 'peer', 'hr', 'audit'));
alter table task_ratings drop constraint if exists task_ratings_task_id_key;
create unique index if not exists task_ratings_task_id_rater_type_key on task_ratings (task_id, rater_type);

alter table factor_ratings add column if not exists rater_type text not null default 'self'
  check (rater_type in ('self', 'supervisor', 'peer', 'hr', 'audit'));
alter table factor_ratings drop constraint if exists factor_ratings_user_id_period_id_factor_id_key;
create unique index if not exists factor_ratings_user_id_period_id_factor_id_rater_type_key
  on factor_ratings (user_id, period_id, factor_id, rater_type);

alter table appraisals add column if not exists rater_type text not null default 'self'
  check (rater_type in ('self', 'supervisor', 'peer', 'hr', 'audit'));
alter table appraisals drop constraint if exists appraisals_user_id_period_id_key;
create unique index if not exists appraisals_user_id_period_id_rater_type_key
  on appraisals (user_id, period_id, rater_type);

create table if not exists rater_assignments (
  id uuid primary key default gen_random_uuid(),
  ratee_id uuid not null references users (id) on delete cascade,
  rater_type text not null check (rater_type in ('supervisor', 'peer', 'hr', 'audit')),
  rater_user_id uuid not null references users (id) on delete cascade,
  unique (ratee_id, rater_type)
);

-- Migration: rater privilege on accounts + Page 3 direct score
alter table users add column if not exists rater_privilege text not null default 'none'
  check (rater_privilege in ('none', 'page3', 'full'));
alter table appraisals add column if not exists overall_score numeric(5, 2);
