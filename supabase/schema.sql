-- ============================================================
-- SHILP-AI Supabase Schema
-- Version: 1.0  |  2024
--
-- Instructions:
--   1. Open your Supabase project → SQL Editor → New query
--   2. Paste this entire file and click "Run"
--   3. Then create the Storage buckets (see bottom of file)
--
-- Tables created:
--   artisan_profiles, products, conversations, messages,
--   reviews, orders
--
-- Storage buckets to create MANUALLY in Supabase Dashboard:
--   product-images     (public)
--   artisan-avatars    (public)
--   chat-attachments   (authenticated)
--   identity-docs      (private — no public access)
--   gi-certificates    (private — no public access)
-- ============================================================

-- ─── Enable UUID extension ────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLE: artisan_profiles
-- One row per artisan user (extends auth.users via id FK).
-- ============================================================
create table if not exists artisan_profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,

  -- Shilp-AI unique identifier: SHILP-{STATE}-{YEAR}-{5DIGIT}
  shilp_artisan_id      text unique not null,

  -- Public profile fields
  name                  text,
  regional_name         text,
  phone                 text,
  craft_cluster         text,
  district              text,
  state                 text,
  bio                   text,
  experience_years      integer,
  avatar_url            text,
  gi_tag_craft          text,
  exhibitions           text[],

  -- Verification tier — the ONLY verification flag exposed publicly
  -- 'normal'           → no badge
  -- 'identity_verified'→ 🟢 Government ID verified
  -- 'gi_craft_verified'→ 🟣 GI/Artisan craft certificate verified
  verification_tier     text not null default 'normal'
    check (verification_tier in ('normal', 'identity_verified', 'gi_craft_verified')),

  -- Private verification flags (visible only to owner via RLS)
  is_identity_verified  boolean not null default false,
  is_gi_verified        boolean not null default false,

  -- Private storage paths — NEVER exposed publicly
  -- These columns are excluded from public SELECT policies.
  identity_doc_ref      text,    -- path inside 'identity-docs' bucket
  gi_cert_ref           text,    -- path inside 'gi-certificates' bucket

  -- Legacy identifiers (kept for MoSJE compatibility)
  beneficiary_id        text,
  shilp_card_number     text,

  -- Stats (updated by DB triggers or edge functions)
  rating                numeric(3,1) not null default 0,
  total_sales_count     integer not null default 0,
  total_earnings        numeric(12,2) not null default 0,
  bank_linked           boolean not null default false,

  onboarding_complete   boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ─── Auto-update updated_at ───────────────────────────────────────────────────
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists artisan_profiles_updated_at on artisan_profiles;
create trigger artisan_profiles_updated_at
  before update on artisan_profiles
  for each row execute function update_updated_at_column();

-- ============================================================
-- TABLE: products
-- ============================================================
create table if not exists products (
  id                    text primary key,
  artisan_id            uuid references artisan_profiles(id) on delete set null,
  artisan_name          text,
  state                 text,

  title_en              text not null,
  title_hi              text,
  category              text not null,
  craft_technique       text,
  primary_material      text,
  color                 text,
  production_days       integer,
  raw_material_cost     numeric(10,2),

  -- Image URLs (public CDN URLs from product-images bucket)
  original_image_url    text,
  enhanced_image_url    text,   -- ALWAYS prefer this for display
  has_background_removed boolean not null default false,
  has_lighting_enhanced  boolean not null default false,

  description_en        text,
  description_hi        text,
  seo_keywords          text[],
  pricing               jsonb,
  target_buyers         text[],
  stock_quantity        integer not null default 1,
  gi_certified          boolean not null default false,
  featured              boolean not null default false,
  product_size          text,
  quality_tier          text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists products_updated_at on products;
create trigger products_updated_at
  before update on products
  for each row execute function update_updated_at_column();

-- ============================================================
-- TABLE: conversations
-- ============================================================
create table if not exists conversations (
  id                    text primary key,
  buyer_id              text not null,
  buyer_name            text,
  artisan_id            uuid references artisan_profiles(id) on delete set null,
  artisan_name          text,
  product_id            text references products(id) on delete set null,
  product_title         text,
  last_message_at       timestamptz not null default now(),
  unread_count          integer not null default 0,
  created_at            timestamptz not null default now()
);

-- ============================================================
-- TABLE: messages  (Realtime enabled)
-- ============================================================
create table if not exists messages (
  id                    text primary key,
  conversation_id       text not null references conversations(id) on delete cascade,
  sender_id             text not null,
  sender_role           text not null check (sender_role in ('artisan', 'buyer')),
  sender_name           text,
  text                  text not null,
  image_url             text,              -- chat image attachment (from chat-attachments bucket)
  customization_request jsonb,
  is_read               boolean not null default false,
  created_at            timestamptz not null default now()
);

-- Enable Realtime for messages table
alter publication supabase_realtime add table messages;

-- ============================================================
-- TABLE: reviews
-- Unique constraint on (product_id, buyer_id) prevents duplicates.
-- ============================================================
create table if not exists reviews (
  id                    text primary key,
  product_id            text not null references products(id) on delete cascade,
  buyer_id              text not null,
  buyer_name            text,
  rating                integer not null check (rating between 1 and 5),
  comment               text,
  image_url             text,              -- optional review photo
  verified_purchase     boolean not null default false,
  created_at            timestamptz not null default now(),

  -- Prevent duplicate reviews from same buyer for same product
  unique (product_id, buyer_id)
);

-- ============================================================
-- TABLE: orders
-- ============================================================
create table if not exists orders (
  id                    text primary key,
  product_id            text references products(id) on delete set null,
  buyer_id              text not null,
  buyer_name            text,
  artisan_id            uuid references artisan_profiles(id) on delete set null,
  quantity              integer not null default 1,
  total_amount          numeric(12,2),
  status                text not null default 'placed'
    check (status in ('placed', 'accepted', 'shipped', 'delivered', 'cancelled')),
  created_at            timestamptz not null default now()
);

-- ─── Trigger: update artisan stats when order is placed ───────────────────────
create or replace function update_artisan_stats_on_order()
returns trigger language plpgsql security definer as $$
begin
  if TG_OP = 'INSERT' and new.artisan_id is not null then
    update artisan_profiles set
      total_sales_count = total_sales_count + new.quantity,
      total_earnings    = total_earnings + coalesce(new.total_amount, 0)
    where id = new.artisan_id;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_update_artisan_stats on orders;
create trigger orders_update_artisan_stats
  after insert on orders
  for each row execute function update_artisan_stats_on_order();

-- ─── Trigger: update artisan avg rating when review is added ──────────────────
create or replace function update_artisan_rating_on_review()
returns trigger language plpgsql security definer as $$
declare
  v_artisan_id uuid;
  v_avg_rating numeric;
begin
  -- Find artisan from the product
  select p.artisan_id into v_artisan_id
  from products p where p.id = new.product_id;

  if v_artisan_id is null then return new; end if;

  -- Recalculate average rating across all reviews for artisan's products
  select avg(r.rating) into v_avg_rating
  from reviews r
  join products p on p.id = r.product_id
  where p.artisan_id = v_artisan_id;

  update artisan_profiles set
    rating = round(coalesce(v_avg_rating, 0), 1)
  where id = v_artisan_id;

  return new;
end;
$$;

drop trigger if exists reviews_update_artisan_rating on reviews;
create trigger reviews_update_artisan_rating
  after insert on reviews
  for each row execute function update_artisan_rating_on_review();


-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table artisan_profiles  enable row level security;
alter table products          enable row level security;
alter table conversations     enable row level security;
alter table messages          enable row level security;
alter table reviews           enable row level security;
alter table orders            enable row level security;

-- ─── artisan_profiles ────────────────────────────────────────────────────────

-- Anyone can read PUBLIC fields (verification_tier, name, etc.)
-- Private columns (identity_doc_ref, gi_cert_ref) are NOT in this select
-- because we don't allow SELECT * — the service layer only selects safe columns.
drop policy if exists "artisan_profiles:public_read" on artisan_profiles;
create policy "artisan_profiles:public_read"
  on artisan_profiles for select
  using (true);   -- public profiles are readable by all

-- Only the artisan can update their own profile
drop policy if exists "artisan_profiles:owner_update" on artisan_profiles;
create policy "artisan_profiles:owner_update"
  on artisan_profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Only authenticated users can insert their own row
drop policy if exists "artisan_profiles:owner_insert" on artisan_profiles;
create policy "artisan_profiles:owner_insert"
  on artisan_profiles for insert
  with check (auth.uid() = id);

-- ─── products ────────────────────────────────────────────────────────────────

-- Anyone can read products (marketplace is public)
drop policy if exists "products:public_read" on products;
create policy "products:public_read"
  on products for select
  using (true);

-- Only the owning artisan can insert/update/delete their products
drop policy if exists "products:artisan_write" on products;
create policy "products:artisan_write"
  on products for insert
  with check (auth.uid() = artisan_id);

drop policy if exists "products:artisan_update" on products;
create policy "products:artisan_update"
  on products for update
  using (auth.uid() = artisan_id)
  with check (auth.uid() = artisan_id);

drop policy if exists "products:artisan_delete" on products;
create policy "products:artisan_delete"
  on products for delete
  using (auth.uid() = artisan_id);

-- ─── conversations ───────────────────────────────────────────────────────────

-- Participants (buyer or artisan) can read their own conversations
drop policy if exists "conversations:participant_read" on conversations;
create policy "conversations:participant_read"
  on conversations for select
  using (
    auth.uid()::text = buyer_id
    or auth.uid() = artisan_id
  );

-- Participants (buyer or artisan) can insert conversations where they are a participant
drop policy if exists "conversations:authenticated_insert" on conversations;
create policy "conversations:authenticated_insert"
  on conversations for insert
  with check (
    auth.role() = 'authenticated'
    and (
      auth.uid()::text = buyer_id
      or auth.uid() = artisan_id
    )
  );

-- Participants (buyer or artisan) can update their own conversations (last_message_at, unread_count)
drop policy if exists "conversations:participant_update" on conversations;
create policy "conversations:participant_update"
  on conversations for update
  using (
    auth.uid()::text = buyer_id
    or auth.uid() = artisan_id
  )
  with check (
    auth.uid()::text = buyer_id
    or auth.uid() = artisan_id
  );

-- ─── messages ────────────────────────────────────────────────────────────────

-- Participants in the conversation can read messages
drop policy if exists "messages:participant_read" on messages;
create policy "messages:participant_read"
  on messages for select
  using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id
      and (auth.uid()::text = c.buyer_id or auth.uid() = c.artisan_id)
    )
  );

-- Authenticated users can insert messages into conversations where they are a participant
drop policy if exists "messages:authenticated_insert" on messages;
create policy "messages:authenticated_insert"
  on messages for insert
  with check (
    auth.role() = 'authenticated'
    and exists (
      select 1 from conversations c
      where c.id = conversation_id
      and (auth.uid()::text = c.buyer_id or auth.uid() = c.artisan_id)
    )
  );

-- ─── reviews ─────────────────────────────────────────────────────────────────

-- Anyone can read reviews (public marketplace)
drop policy if exists "reviews:public_read" on reviews;
create policy "reviews:public_read"
  on reviews for select
  using (true);

-- Authenticated users can insert reviews (DB unique constraint prevents duplicates)
drop policy if exists "reviews:authenticated_insert" on reviews;
create policy "reviews:authenticated_insert"
  on reviews for insert
  with check (auth.role() = 'authenticated');

-- ─── orders ──────────────────────────────────────────────────────────────────

-- Buyers and artisans can only see their own orders
drop policy if exists "orders:participant_read" on orders;
create policy "orders:participant_read"
  on orders for select
  using (
    auth.uid()::text = buyer_id
    or auth.uid() = artisan_id
  );

drop policy if exists "orders:authenticated_insert" on orders;
create policy "orders:authenticated_insert"
  on orders for insert
  with check (auth.role() = 'authenticated');


-- ============================================================
-- STORAGE BUCKET POLICIES
-- (Run these after creating buckets in Supabase Dashboard)
-- ============================================================

-- ─── product-images (public bucket) ──────────────────────────────────────────
-- In Supabase Dashboard: Storage → New bucket → "product-images" → Public: YES

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "product-images: public read"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "product-images: artisan upload"
  on storage.objects for insert
  with check (bucket_id = 'product-images' and auth.role() = 'authenticated');

create policy "product-images: artisan update own"
  on storage.objects for update
  using (bucket_id = 'product-images' and auth.uid()::text = (storage.foldername(name))[1]);

-- ─── artisan-avatars (public bucket) ─────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('artisan-avatars', 'artisan-avatars', true)
on conflict (id) do nothing;

create policy "artisan-avatars: public read"
  on storage.objects for select
  using (bucket_id = 'artisan-avatars');

create policy "artisan-avatars: owner upload"
  on storage.objects for insert
  with check (
    bucket_id = 'artisan-avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── chat-attachments (authenticated read) ───────────────────────────────────
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

create policy "chat-attachments: authenticated read"
  on storage.objects for select
  using (bucket_id = 'chat-attachments' and auth.role() = 'authenticated');

create policy "chat-attachments: authenticated upload"
  on storage.objects for insert
  with check (bucket_id = 'chat-attachments' and auth.role() = 'authenticated');

-- ─── identity-docs (PRIVATE — owner only) ────────────────────────────────────
-- NEVER create a public policy on this bucket.
insert into storage.buckets (id, name, public)
values ('identity-docs', 'identity-docs', false)
on conflict (id) do nothing;

create policy "identity-docs: owner read only"
  on storage.objects for select
  using (
    bucket_id = 'identity-docs'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "identity-docs: owner upload only"
  on storage.objects for insert
  with check (
    bucket_id = 'identity-docs'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── gi-certificates (PRIVATE — owner only) ──────────────────────────────────
insert into storage.buckets (id, name, public)
values ('gi-certificates', 'gi-certificates', false)
on conflict (id) do nothing;

create policy "gi-certificates: owner read only"
  on storage.objects for select
  using (
    bucket_id = 'gi-certificates'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "gi-certificates: owner upload only"
  on storage.objects for insert
  with check (
    bucket_id = 'gi-certificates'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ============================================================
-- SEED: Demo product data (optional — remove before production)
-- This allows the app to render sample listings without real artisan logins.
-- ============================================================

-- (Leave empty for now — the app seeds from localStorage/craftPresets.ts)
