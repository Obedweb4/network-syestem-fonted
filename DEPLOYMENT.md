# Deploying PulseNet

This project is configured as a Replit PNPM workspace (`.replit`). The most direct deployment path is to import this repository into Replit, add the environment variables below, create a PostgreSQL database, and use Replit Deployments.

## Required environment variables

Copy `.env.example` to your deployment's secret/environment-variable store. Never commit the real values.

- `DATABASE_URL`: PostgreSQL connection URL.
- `JWT_SECRET`: a long random production secret.
- `PORT`: API service port (the deployment platform normally supplies this).
- `NODE_ENV=production`.
- `CORS_ORIGINS`: comma-separated HTTPS origins for the customer portal and admin app.

## Install and build

The archive includes `pnpm-workspace.yaml`, so a clean deployment can resolve the internal workspaces:

```sh
corepack enable
pnpm install --frozen-lockfile=false
pnpm typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/admin build
pnpm --filter @workspace/customer-portal build
pnpm --filter @workspace/radius-server build
```

## RADIUS (AAA) server — optional, separate process

`@workspace/radius-server` (`artifacts/radius-server`) is a standalone UDP
daemon, independent of the HTTP `api-server` process — it must be started
and kept running separately (`pnpm --filter @workspace/radius-server start`)
if any tenant enables RADIUS. It needs `DATABASE_URL` and
`PROVISIONING_CREDENTIAL_KEY` set to the *same values* api-server uses (it
decrypts the same router-password and RADIUS-secret ciphertexts), plus the
optional `RADIUS_AUTH_PORT` / `RADIUS_ACCT_PORT` / `RADIUS_BIND_HOST` vars —
see `.env.example`. It listens on UDP 1812 (Access-Request) and UDP 1813
(Accounting-Request) by default and must be reachable from every NAS
(MikroTik router) a tenant points at it; open those ports on the deployment
platform's firewall/load balancer (UDP, not HTTP) before enabling RADIUS on
any router. A NAS is matched to its tenant purely by source IP (`routers.ipAddress`),
so a router's IP in PulseNet must be its real, stable public/reachable
source address for RADIUS traffic.

## Create the initial administrator

After the database schema is applied, set `SEED_ADMIN_PASSWORD` in the secret
store and run `pnpm --filter @workspace/scripts seed:initial` once. The seed
creates the configured administrator and default customer idempotently; it does
not reset an existing administrator password.

## Database

The database schema is defined in `lib/db/src/schema`. Apply the Drizzle schema/migrations before starting the API. This source archive does not include a database dump, user accounts, routers, or MikroTik credentials.

## MikroTik prerequisites

1. Add each router through the admin application with a restricted RouterOS API user.
2. Provision each paid subscriber and create its `provisioning_mappings` record with the router ID and RouterOS username.
3. Upload `mikrotik-hotspot/hotspot/` to the router and customise/import `mikrotik-hotspot/routeros/apply-after-customising.rsc`.
4. Keep the API process running continuously; it performs expiry enforcement every minute.

## Production notes

- Place the admin site, customer portal, and API behind HTTPS. Their API calls expect `/api` to route to the API service.
- The API only accepts origins listed in `CORS_ORIGINS`; set it before public launch.
- Encrypt RouterOS API secrets at rest before putting real routers into production. The current schema stores the field as plain text.
- Take a database backup before importing production customers or subscriptions.

## Payment and access go-live gate

This repository deliberately creates an STK payment request in `PENDING` state only. Before commercial use, connect a per-tenant Daraja payment worker, validate its callbacks, and atomically activate the subscription, invoice, receipt, loyalty award, and RouterOS provisioning only after a successful callback. Never simulate approval or grant access from the browser.

The legacy identifier-only customer sign-in has been disabled because it permits account takeover. Configure a tenant OTP provider (including rate limits and an abuse budget) before enabling customer dashboard login.
