-- Fresh start: drop existing tables
drop table if exists order_items cascade;
drop table if exists orders cascade;
drop table if exists stock cascade;

-- Core bar registry
create table bars (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_telegram_id bigint not null unique,
  owner_name text,
  status text not null default 'pending', -- pending | approved | rejected
  is_open boolean not null default false,
  deep_link_code text unique,
  created_at timestamptz not null default now()
);

-- Staff groups per bar (owner, bartender, waitress groups)
create table bar_groups (
  id uuid primary key default gen_random_uuid(),
  bar_id uuid not null references bars(id) on delete cascade,
  chat_id bigint not null,
  label text not null,   -- e.g. "Bartender", "Waitress A"
  type text not null,    -- owner | bartender | waitress
  created_at timestamptz not null default now()
);

-- Tables per bar, each assigned to a waitress group
create table bar_tables (
  id uuid primary key default gen_random_uuid(),
  bar_id uuid not null references bars(id) on delete cascade,
  table_name text not null,
  group_id uuid references bar_groups(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Menu categories, each routed to a specific group
create table bar_menu_categories (
  id uuid primary key default gen_random_uuid(),
  bar_id uuid not null references bars(id) on delete cascade,
  name text not null,
  routes_to_group_id uuid references bar_groups(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Menu items per category
create table bar_menu_items (
  id uuid primary key default gen_random_uuid(),
  bar_id uuid not null references bars(id) on delete cascade,
  category_id uuid not null references bar_menu_categories(id) on delete cascade,
  name text not null,
  price numeric not null,
  is_available boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Walk-in staff per bar
create table bar_staff (
  id uuid primary key default gen_random_uuid(),
  bar_id uuid not null references bars(id) on delete cascade,
  telegram_user_id bigint not null,
  created_at timestamptz not null default now(),
  unique(bar_id, telegram_user_id)
);

-- Orders
create table orders (
  id uuid primary key default gen_random_uuid(),
  bar_id uuid not null references bars(id),
  table_name text,
  customer text,
  total numeric not null default 0,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

-- Order items
create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  bar_id uuid not null references bars(id),
  round_number int,
  item_name text,
  category text,
  qty int,
  price numeric,
  created_at timestamptz not null default now()
);

-- Stock
create table stock (
  id uuid primary key default gen_random_uuid(),
  bar_id uuid not null references bars(id),
  item_name text not null,
  quantity numeric not null default 0,
  low_stock_threshold numeric not null default 5,
  updated_at timestamptz not null default now(),
  unique(bar_id, item_name)
);
