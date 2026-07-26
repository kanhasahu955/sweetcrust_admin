# SweetCrust Admin

Nuxt 4 ops console for bakery B2B + last-mile: shops, catalog, orders, picking, routing, riders, chat, payments.

Stack: **Vue 3 · Nuxt 4 · Nuxt UI · Pinia · socket.io · Chart.js**. Talks to the API gateway over JWT (`useApi`) and realtime (`useSocket` / `admin_event`).

## Quick start

```bash
cd admin
cp .env.example .env   # if needed
npm install
npm run dev            # http://localhost:3002
```

Dev server port is **3002** (see `nuxt.config.ts` → `devServer.port` and `package.json` `dev` script).

### Env

| Variable | Local default | Purpose |
|----------|---------------|---------|
| `NUXT_PUBLIC_API_BASE` | `http://127.0.0.1:8080` | Gateway HTTP |
| `NUXT_PUBLIC_SOCKET_BASE` | `http://127.0.0.1:8081` | Socket.IO realtime |

Production examples live in `.env.production.example` (e.g. `https://admin.skbakery.in` or `https://api.skbakery.in`).

Gateway + socket must be running for login, lists, and live badges (orders / chat / pending shops).

## Scripts

```bash
npm run dev       # port 3002
npm run build     # production bundle
npm run preview   # preview build locally
```

## Production notes

- Prefer HTTPS origins for `NUXT_PUBLIC_*` so the browser does not hit mixed-content blocks.
- Behind nginx TLS, keep CSP `upgrade-insecure-requests` (already in `nuxt.config.ts` `routeRules`).
- Icons use `/_nuxt_icon` so they do not collide with gateway `location /api/`.
- List fetches use `cache: "no-store"` via `useApi` — do not add aggressive client caching for ops tables.
- Charts are lazy-loaded on the dashboard; avoid mounting heavy charts on every route.
- Deploy helpers: `deploy/hostinger/` (GitHub Actions bootstrap docs included).

## App map

| Area | Routes |
|------|--------|
| Shell | Login (`auth` layout), sticky topbar, collapsible sidebar (drawer below `lg`) |
| Command center | `/dashboard` — KPIs, ops queue, activity feed |
| Commerce | `/orders`, `/shops`, `/products`, `/categories`, `/inventory`, `/pricing`, `/assortment`, `/purchases`, `/payments` |
| Fulfillment | `/picking`, `/routing`, `/delivery`, `/chats` |
| More | Offers, banners, customers, reports, forecast, returns, notifications, settings, services, …

Auth middleware guards app routes; token stored in Pinia (`stores/auth`).
