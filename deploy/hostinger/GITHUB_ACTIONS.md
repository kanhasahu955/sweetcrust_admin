# Admin CI/CD → Hostinger VPS

Repo: https://github.com/kanhasahu955/sweetcrust_admin  
Live: https://admin.skbakery.in  
API: https://api.skbakery.in  
VPS path: `/opt/sweetcrust/admin`

```text
git push main → GitHub Actions → SSH/rsync → /opt/sweetcrust/admin → docker compose up --build
```

## One-time secrets (same SSH key as sweetcrust_api)

```bash
cd admin
chmod +x deploy/hostinger/bootstrap-github-secrets.sh
./deploy/hostinger/bootstrap-github-secrets.sh --email support@bakerywala.cloud
```

Sets on `kanhasahu955/sweetcrust_admin`:

| Secret | Value |
|--------|--------|
| `HOSTINGER_HOST` | `145.223.21.127` |
| `HOSTINGER_USER` | `root` |
| `HOSTINGER_SSH_KEY` | `~/.ssh/hostinger_gha` |
| `CERTBOT_EMAIL` | optional |

Variables (optional): `NUXT_PUBLIC_API_BASE`, `NUXT_PUBLIC_SOCKET_BASE` (default `https://api.skbakery.in`).

## Deploy

```bash
git add -A && git commit -m "…" && git push origin main
```

Or: Actions → **Deploy Admin** → **Run workflow**.

## Laptop deploy (without waiting for Actions)

```bash
./deploy/hostinger/deploy.sh
```
