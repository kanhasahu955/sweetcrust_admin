# Deploy Admin → Hostinger VPS

| | |
|--|--|
| URL | `https://admin.skbakery.in` |
| API | `https://api.skbakery.in` |
| VPS path | `/opt/sweetcrust/admin` |
| Network | joins `backend_v2_sweetcrust` (nginx in backend terminates TLS) |

## One-time

1. DNS: `admin.skbakery.in` A → `145.223.21.127`
2. GitHub repo secrets (same as API): `HOSTINGER_HOST`, `HOSTINGER_USER`, `HOSTINGER_SSH_KEY`, optional `CERTBOT_EMAIL`
3. Push this `admin/` repo to GitHub (or rsync from laptop)

## Laptop deploy (no GitHub yet)

```bash
cd admin
cp .env.production.example .env.production   # already points at api.skbakery.in
./deploy/hostinger/deploy.sh
# then on VPS (or from laptop SSH):
ssh root@145.223.21.127 'cd /opt/sweetcrust/admin && ./deploy/hostinger/issue-cert.sh'
```

## GitHub Actions

Push `main` → workflow writes `.env.production` with production API URLs → rsync → `docker compose up --build`.

## CORS

Backend CORS must include `https://admin.skbakery.in` (already in sync-env overlays).
