# RB-VPN

Commercial WireGuard VPN platform: **website** (sell + account) · **API** (auth, billing, peers) · **Linux VPS nodes** · **Windows client**.

Traffic path (same idea as the ChatGPT WireGuard/VPS setup):

```text
Windows PC  →  WireGuard tunnel  →  Linux VPS (NAT)  →  Internet
```

Sites see the **VPS public IP**.

## Stack

| Piece | Tech |
|--------|------|
| Website | Next.js (`website/`) |
| Control API | Express + Prisma + PostgreSQL (`api/`) |
| Payments | Stripe + NOWPayments (crypto) |
| VPN node | WireGuard + Node agent (`server/`) |
| Windows app | Electron + WireGuard for Windows (`client-windows/`) |

## Quick start (local)

### 1) API

Requires a local PostgreSQL database (default URL in `.env.example`).

```bash
cd api
cp .env.example .env   # set DATABASE_URL to your Postgres instance
npm install
npm run db:setup
npm run dev
```

End-to-end API tests (they start the API themselves on ports 4100/4101 and refuse any database whose name does not end in `_test`):

```bash
cd api
DATABASE_URL="postgresql://rbvpn:PASSWORD@127.0.0.1:5432/rbvpn_test?schema=public" npx prisma db push
DATABASE_URL="postgresql://rbvpn:PASSWORD@127.0.0.1:5432/rbvpn_test?schema=public" npm run test:integration
```

On Ubuntu/Debian you can provision Postgres with:

```bash
sudo bash server/scripts/setup-postgres.sh
```

API: `http://localhost:4000`  
Admin seed: `admin@rbvpn.local` (or `ADMIN_EMAIL`). The password is `ADMIN_PASSWORD` from `.env`; if unset, the seed prints a random one once. The seed only creates missing rows, so plans and nodes edited in the admin panel are never overwritten.

### 2) Website

```bash
cd website
npm install
npm run dev
```

Site: `http://localhost:3000`

### 3) Windows client

The installer bundles the WireGuard runtime (`npm run prepare:runtime` downloads it for development). Run as administrator:

```bash
cd client-windows
npm install
npm run prepare:runtime
npm start
```

Build the MSI with `npm run dist:msi` (output in `client-windows/dist-msi`; the version comes from the build date).

Sign in with a user that has an **active subscription**. For local testing without Stripe/NOWPayments keys, set `ALLOW_MOCK_PAYMENTS=true` in `api/.env`: checkout then activates the plan without charging. Admins can also grant plans from **Admin → Users**.

### 4) Linux VPS node

On an Ubuntu/Debian VPS:

```bash
sudo bash server/scripts/setup-wireguard.sh
```

Copy the printed **public IP** and **server public key** into the API node record (seed node `seed-node-us` or create via admin).

Then on the VPS:

```bash
cd server/vpn-agent
cp .env.example .env
# set API_URL, NODE_ID, NODE_AGENT_SECRET (must match api/.env)
npm install
sudo bash ../scripts/install-agent.sh "$(pwd)"
```

Open UDP `51820` (or your `WG_PORT`) in the VPS firewall.

## Payments setup

### Stripe

In `api/.env`:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- optional `STRIPE_PRICE_BASIC` / `STRIPE_PRICE_PRO` / `STRIPE_PRICE_BASIC_ANNUAL` / `STRIPE_PRICE_PRO_ANNUAL` (otherwise the plan price is sent to Stripe directly)

Webhook endpoint: `POST /api/payments/stripe/webhook` — subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`.

### Crypto (NOWPayments)

- `NOWPAYMENTS_API_KEY`
- `NOWPAYMENTS_IPN_SECRET` (required — every IPN is checked against its `x-nowpayments-sig` signature)
- `NOWPAYMENTS_SANDBOX=true` for test

IPN endpoint: `POST /api/payments/crypto/ipn`

A provider is offered on the pricing page only when both of its keys are set. With no provider configured the pricing page asks customers to contact you, and plans can be granted from the admin panel. `ALLOW_MOCK_PAYMENTS=true` turns unconfigured providers into a no-charge test checkout — local development only.

## User flow

1. Register on the website  
2. Buy Basic/Pro (Stripe or crypto)  
3. Windows app creates its device on first Connect  
4. Connect: the API assigns a VPN IP and the node agent adds the WireGuard peer  
5. Traffic exits via the VPS IP; Disconnect (or quitting the app) frees the IP  

While connected, the app checks the tunnel every 30 seconds. If the server drops the session (VPS reboot, plan ended, admin disconnect) it reconnects or disconnects cleanly, so the PC is not left without internet.

The API frees sessions when a plan expires or is cancelled, when a user is suspended, and after `STALE_SESSION_HOURS` without a WireGuard handshake.

The node agent reconciles the whole interface every poll: after a VPS reboot it restores connected peers, and it removes peers the API no longer knows (`PRUNE_UNKNOWN_PEERS`, `KEEP_PEERS` in `server/vpn-agent/.env`). Run its tests with `npm test` in `server/vpn-agent`.

## Repo layout

```text
api/                 Control plane API + Prisma
website/             Marketing site + dashboard
server/scripts/      WireGuard bootstrap + agent install
server/vpn-agent/    Polls API and runs `wg set`
client-windows/      Electron desktop client
```

## Deploy local code to VPS

Keep VPS credentials in repo-root `vps info` (gitignored):

```text
ip : 162.35.175.39
user : root
password : YOUR_PASSWORD
```

After you change local source, sync and restart production services:

```bash
npm run deploy:vps
```

Or:

```powershell
.\deploy.ps1
```

Useful variants:

```bash
npm run deploy:vps:web          # website only
npm run deploy:vps:api          # api + agent only
python server/scripts/deploy-to-vps.py --skip-build
```

This uploads to `/opt/rbvpn`, runs install/build as needed, and restarts `rbvpn-api`, `rbvpn-agent`, `rbvpn-web`, `nginx`.  
VPS `.env` files and databases are **not** overwritten, with one exception: a missing, short, or default `JWT_SECRET` / `NODE_AGENT_SECRET` is replaced with a random value (replacing `JWT_SECRET` signs everyone out).  
The newest `client-windows/dist-msi/RB-VPN-Setup-*.msi` is copied to the download page when it is newer than the current one.

## Production notes

- `JWT_SECRET` and `NODE_AGENT_SECRET` must be long random values (the API logs a warning otherwise; deploy fixes it)
- Keep `ALLOW_MOCK_PAYMENTS` unset or `false`
- Change the seeded admin password from the dashboard after the first login
- PostgreSQL is provisioned by `server/scripts/setup-postgres.sh` (also run automatically on API deploy)
- Put API behind HTTPS; point website `NEXT_PUBLIC_API_URL` at it
- Register real node public keys (never leave `REPLACE_WITH_SERVER_PUBLIC_KEY`)
- For restrictive networks, plain WireGuard UDP may be blocked — plan obfuscation/transport upgrades separately
- Review `/terms` and `/privacy` (`website/app/terms`, `website/app/privacy`) for your business and jurisdiction before taking payments

## Brand

**RB-VPN**
