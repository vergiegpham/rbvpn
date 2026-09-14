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
| Control API | Express + Prisma + SQLite (`api/`) |
| Payments | Stripe + NOWPayments (crypto) |
| VPN node | WireGuard + Node agent (`server/`) |
| Windows app | Electron + WireGuard for Windows (`client-windows/`) |

## Quick start (local)

### 1) API

```bash
cd api
cp .env.example .env   # already seeded .env for local dev
npm install
npm run db:setup
npm run dev
```

API: `http://localhost:4000`  
Admin seed: `admin@rbvpn.local` / `admin123!`

### 2) Website

```bash
cd website
npm install
npm run dev
```

Site: `http://localhost:3000`

### 3) Windows client

1. Install [WireGuard for Windows](https://www.wireguard.com/install/)
2. Run:

```bash
cd client-windows
npm install
npm start
```

Sign in with a user that has an **active subscription**. Without Stripe/NOWPayments keys, the site checkout returns a **mock payment** URL that activates the plan for testing.

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
- optional `STRIPE_PRICE_BASIC` / `STRIPE_PRICE_PRO`

Webhook endpoint: `POST /api/payments/stripe/webhook`

### Crypto (NOWPayments)

- `NOWPAYMENTS_API_KEY`
- `NOWPAYMENTS_IPN_SECRET`
- `NOWPAYMENTS_SANDBOX=true` for test

IPN endpoint: `POST /api/payments/crypto/ipn`

If keys are empty, checkout uses **mock pay** so you can develop without live billing.

## User flow

1. Register on the website  
2. Buy Basic/Pro (Stripe or crypto)  
3. Dashboard → add device (or client auto-creates one)  
4. Node agent applies WireGuard peer  
5. Windows app Connect → traffic exits via VPS IP  

## Repo layout

```text
api/                 Control plane API + Prisma
website/             Marketing site + dashboard
server/scripts/      WireGuard bootstrap + agent install
server/vpn-agent/    Polls API and runs `wg set`
client-windows/      Electron desktop client
```

## Production notes

- Change `JWT_SECRET` and `NODE_AGENT_SECRET`
- Use Postgres instead of SQLite (`provider = "postgresql"` in Prisma)
- Put API behind HTTPS; point website `NEXT_PUBLIC_API_URL` at it
- Register real node public keys (never leave `REPLACE_WITH_SERVER_PUBLIC_KEY`)
- For restrictive networks, plain WireGuard UDP may be blocked — plan obfuscation/transport upgrades separately
- Add ToS, privacy policy, and abuse handling before taking payments

## Brand

**RB-VPN**
