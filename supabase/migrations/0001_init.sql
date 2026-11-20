-- Frozen database schema (supabase/migrations/0001_init.sql)
-- Chronyx Contract v1.0.0 (Part E3)

create extension if not exists pgcrypto;

create table nodes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('browser','virtual')),
  public_key text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table heartbeats (
  id bigserial primary key,
  node_id uuid not null references nodes(id),
  seq bigint not null,
  t_local_ms double precision not null,
  t_rx_ms double precision not null,
  prev_hash text not null,
  hash text not null,
  sig text not null,
  body jsonb not null,
  flags text[] not null default '{}',
  unique (node_id, seq)
);

create table assessments (
  id bigserial primary key,
  node_id uuid not null references nodes(id),
  t_ms double precision not null,
  state text not null,
  error_est_ms double precision,
  sigma_ms double precision,
  z double precision,
  cusum double precision,
  confidence double precision,
  reasons text[] not null default '{}',
  suspected_cause text,
  streams jsonb
);

create table transitions (
  id bigserial primary key,
  node_id uuid not null references nodes(id),
  at_ms double precision not null,
  from_state text not null,
  to_state text not null,
  reasons text[] not null default '{}',
  error_est_ms double precision,
  incident_id uuid
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id),
  status text not null check (status in ('open','closed')),
  opened_at_ms double precision not null,
  closed_at_ms double precision,
  peak_error_ms double precision not null default 0,
  detection_latency_s double precision,
  cause text not null default 'unknown',
  summary text not null default '',
  evidence jsonb not null default '{}'
);

create table faults (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  node_id uuid not null references nodes(id),
  params jsonb not null,
  started_at_ms double precision not null,
  ends_at_ms double precision,
  status text not null check (status in ('active','stopped','expired')),
  applies_to text not null,
  detected_at_ms double precision,
  error_at_detect_ms double precision,
  detection_latency_s double precision
);

create table observations (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id),
  kind text not null,
  observed_at_ms double precision not null,
  payload jsonb not null default '{}',
  status text not null check (status in ('accepted','held','released','rejected')),
  confidence double precision not null,
  state_at_ingest text not null,
  created_at timestamptz not null default now()
);

create table benchmark_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null,
  scenario text not null,
  repeats int not null,
  seed int not null,
  params jsonb not null default '{}',
  progress jsonb not null default '{}',
  results jsonb,
  created_at timestamptz not null default now()
);

create table anchors (
  id bigserial primary key,
  host text not null,
  offset_ms double precision,
  rtt_ms double precision,
  ok boolean not null,
  sampled_at_ms double precision not null
);

create table config (
  key text primary key,
  value jsonb not null
);

create index on heartbeats (node_id, seq desc);
create index on assessments (node_id, t_ms);
create index on transitions (node_id, at_ms);
create index on incidents (status);

-- Enable RLS on every table; no policies so anonymous access is denied
alter table nodes enable row level security;
alter table heartbeats enable row level security;
alter table assessments enable row level security;
alter table transitions enable row level security;
alter table incidents enable row level security;
alter table faults enable row level security;
alter table observations enable row level security;
alter table benchmark_runs enable row level security;
alter table anchors enable row level security;
alter table config enable row level security;

