# Bar POS Bot — Project Context

## What this project is
A Telegram-based bar ordering system built with Node.js. Customers order via a Telegram bot, staff get notified in their respective Telegram groups, and the bar owner has a web dashboard for analytics and stock management.

## Stack
- **Bot:** Node.js + Telegraf v4 (Telegram bot framework)
- **Database:** Supabase (PostgreSQL) via `@supabase/supabase-js`
- **Hosting:** Railway (bot) + Netlify (dashboard)
- **Dashboard:** Vanilla HTML/CSS/JS — single file `dashboard.html`
- **Menu:** Loaded from `menu.json` at startup

## Project structure
```
index.js          # Main bot file — all bot logic lives here
menu.json         # Menu categories and items with prices (ETB)
dashboard.html    # Owner analytics dashboard (hosted on Netlify)
Procfile          # Railway start command: worker: node index.js
.env              # Local env vars (never committed)
```

## Environment variables
```
BOT_TOKEN         # Telegram bot token
SUPABASE_URL      # https://gzwxcdjvezevyvicamgc.supabase.co
SUPABASE_ANON_KEY # Supabase anon/public key
```

## Telegram group IDs (hardcoded in index.js)
```
BARTENDER_GROUP_ID  = -5098569760   # Whiskey + Wine orders + Bills + /open /close
WAITRESS_1_GROUP_ID = -5253381539   # Tables 1-3, Beers + Soft Drinks
WAITRESS_2_GROUP_ID = -5257042379   # Tables 4-6, Beers + Soft Drinks
OWNER_GROUP_ID      = -5040789601   # Payment notifications + /offer + /open /close + dashboard link
```

## Supabase tables
- `orders` — id, table_name, customer, total, status (open/paid), created_at, paid_at
- `order_items` — id, order_id, round_number, item_name, category, qty, price, created_at
- `stock` — id, item_name, quantity, low_stock_threshold, updated_at

## Key bot logic
- **Menu routing:** Beers + Soft Drinks → waitress groups. Whiskey + Wine → bartender group
- **Table routing:** Tables 1-3 → Waitress 1. Tables 4-6 → Waitress 2
- **Session state:** `step` (idle → selecting_table → ordering → browsing_category), `cart`, `tab`, `orderId`, `userId`
- **Order counter:** Global `orderCounter` increments per checkout, resets on `/close`
- **Bar state:** `barIsOpen` boolean — toggled by `/open` and `/close` commands
- **Active customers:** `activeCustomers` Set — tracks userId of customers currently ordering for `/offer` broadcast
- **tableUserMap:** Maps table name to customer userId for direct notifications

## Staff commands
- `/open` — opens the bar (owner or bartender group)
- `/close` — closes bar + sends daily summary to owner + bartender + shift summary to each waitress group
- `/offer [message]` — broadcasts special offer to all active customers (owner group only)
- `/dashboard` — sends dashboard link to owner group (owner group only)

## Customer flow
1. `/start` → inline "Start Ordering" button
2. Select table → category menu appears
3. Browse category → add items to cart
4. Checkout → sends round to staff, deducts stock, notifies owner if low stock
5. Request bill → full breakdown sent to customer + bartender gets PAID button
6. Bartender taps PAID → customer gets thank you message, owner gets payment + daily total

## Callback data formats
- Order status: `status_{action}_{staffType}_{orderId}` where action = received/inprogress/served
- Payment: `paid|{table}|{orderId}|{total}` (pipe separator to avoid space conflicts)
- Waiter call: `waiter_ack_{callId}_U{userId}`

## Dashboard (dashboard.html)
Hosted on Netlify. Talks directly to Supabase REST API using anon key.
Tabs: Today | By Category | Tables | Monthly | Stock
Stock tab allows owner to add/update stock levels and thresholds.

## Currency
All prices in ETB (Ethiopian Birr)

## Important notes
- Bot runs in polling mode (not webhook) — only one instance should run at a time
- `menu.json` is loaded once at startup — restart bot after menu changes
- Stock items must be added manually in the dashboard before deduction works
- The catch-all `RAW CALLBACK` logger should be removed before going to production
- `socks-proxy-agent` is installed but not used — can be removed