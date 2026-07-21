# PulseNet Billing & Network Operations Platform

## Applications

- **Admin dashboard**: staff manage customers, plans, invoices, vouchers, subscriptions, routers, alerts, and billing operations.
- **Customer portal**: customers log in, view packages, purchase service, view sessions, manage profiles, wallet, and loyalty features.
- **API server**: protected Express API that applies business rules, talks to PostgreSQL and reads RouterOS data.
- **MikroTik integration**: resilient RouterOS API client for monitoring, PPPoE/Hotspot session counts, provisioning, suspension, and expiry enforcement.
- **Captive portal**: Router-hosted Hotspot login assets that trigger device captive-network detection.

## AI Network Analyst

The Admin Dashboard has an AI Network Analyst panel. It is an administrator-only operational analyst, not an autonomous router controller.

- Collects live CPU, memory, connected PPPoE/Hotspot users and interface traffic samples from enabled routers.
- Refreshes the live traffic chart every 10 seconds, retaining the latest 24 samples while the page is open.
- Scores network health from router reachability, router load, unresolved alerts, expiring subscriptions, and overdue invoices.
- Gives actions such as checking an unreachable router, reviewing high load before peak time, sending renewal reminders, and following up overdue accounts.
- Uses tenant-scoped server data only. It does not expose RouterOS credentials to the browser.

The exact permissions and safety boundary are in `AI_ANALYST_ROLE.md`.

## AI NOC (Network Operations Center)

A separate, newer component from the AI Network Analyst above. It continuously polls router health, detects faults/anomalies/congestion, correlates outages, forecasts capacity, and proposes remediations — and, unlike the read-only Analyst, may carry out a narrow fixed allowlist of actions (restart its own monitoring, retry provisioning, disconnect a session already orphaned in billing). This is **off by default per tenant** (`noc_settings.auto_remediation_enabled`); anything touching a customer's subscription (suspend/reactivate/reprovision) always requires a staff approval regardless of that setting. Full permission boundary and safety mechanics: `AI_NOC_ROLE.md`. Surfaced in the admin app under Network Monitor → AI NOC tab.

## Invoices & payments

Two payment-recording endpoints exist: `POST /invoices/:id/payments` (invoice-scoped) and `POST /payments` (standalone, `invoiceId` optional). Both apply the same side effects — marking an invoice `PAID` once its COMPLETED payments sum to `totalAmount`, and debiting a `WALLET`-method payment from the customer's wallet — via one shared `applyPaymentEffects()` helper in `routes/invoices.ts`, run inside the same transaction as the payment insert. The admin Invoices page's "Record Payment" dialog calls the invoice-scoped route via a hand-written wrapper (`lib/invoices-api.ts::recordInvoicePayment`, documented in `openapi.yaml` as `recordInvoicePayment` but not yet regenerated into a hook) rather than the generated `useRecordPayment`, which only covers the standalone route.

`POST /customers/:id/recharge` (credit a customer's wallet by a fixed amount, e.g. a cash top-up) and `POST /customers/:id/refill` (extend their active subscription by N days without changing plan/price) have existed on the backend for a while but had no admin UI calling them until now — both are on the client detail page (`pages/customer-detail.tsx`, "Recharge" on the Wallet card and "Refill" on the Active Subscription card, prompt()-based like the existing "Edit Profile" action), via a hand-written wrapper (`lib/customers-api.ts`, same undocumented-hook situation as `recordInvoicePayment`).

A **Reports** tab on the same page (`/invoices?view=reports`, matching the `?view=` pattern `mikrotik-monitor.tsx` already uses for NOC tabs) shows total received, a by-method breakdown, and the 50 most recent payments, from `GET /payments/report`.

## Loyalty Points

`loyalty_accounts`/`loyalty_transactions` existed from early on (viewable and redeemable via the customer portal's Loyalty page), but nothing ever credited a point — there was no earn side to the feature at all. Fixed: `tenants.loyalty_points_per_kes` (Settings > Loyalty Points, defaults to `0` — earning stays off until a tenant sets a rate, so this changes no behavior for an existing deployment on its own) is applied automatically inside `subscription-lifecycle.ts::renewOrCreateSubscription` — the same shared function both M-PESA payment activation and voucher redemption funnel through — so a customer earns points identically regardless of how they paid. `tenants.loyalty_redemption_value_kes` sets what a point is worth on redemption. `POST /customers/:id/loyalty-adjust` (wired to an "Adjust" button on the customer detail page, mirroring the existing wallet "Recharge" button) covers the human-initiated exception path — bonuses, corrections — separately from automatic earning.

## Expiry enforcement

On API startup and every 60 seconds, the server finds active subscriptions past `expiresAt` that have a provisioning mapping. It disables the corresponding PPPoE secret or Hotspot user, removes active sessions, then marks the subscription `EXPIRED`. A router outage leaves the record active so the next sweep can retry.

A second, independent sweep (every 15 minutes, `startExpiryReminderSweep`) sends an `expiry_reminder` SMS to any `ACTIVE` subscription entering its final 24 hours, once per billing period (`subscriptions.expiryReminderSentAt` guards against duplicates and is cleared on renewal).

## Customer OTP login & SMS notifications

Customers never set a password. `POST /portal/auth/otp/request` (rate-limited) queues a 6-digit code — only its hash is stored (`customer_otp_codes`) — and `POST /portal/auth/otp/verify` exchanges a correct, unexpired code for a session token, the only way a customer token is ever issued. Both endpoints return the same generic response regardless of whether the phone number is registered, so neither can be used to enumerate customers. This is separate from the captive portal (`mikrotik-hotspot/hotspot/login.html`), which deliberately has no login at all — OTP is for a future/optional customer-facing web portal (`artifacts/customer-portal`) where someone wants to check their account outside of buying Wi-Fi. That portal's Profile page edits name/email/address via `PATCH /portal/me`, which mirrors `GET /portal/me`'s response shape so the query cache updates in place after a save.

Every customer-facing event in the provisioning lifecycle (activation, suspension, reactivation, cancellation, plan/router changes, password reset, OTP codes, expiry reminders, welcome) goes through one function, `queueCustomerNotification()` (`lib/notify.ts`), which:
1. Renders a tenant's own template override if they have one, otherwise a built-in default (`lib/notification-templates.ts`) — see `NOTIFICATION_EVENTS` for the full event list and each one's expected variables.
2. Writes a `notification_logs` row with the actual rendered message body (not just a receipt).
3. Attempts immediate delivery through whichever SMS provider is configured for that tenant (`lib/sms/` — currently Texin, `lib/sms/noop-provider.ts` if none configured), falling back to the deployment-wide `TEXIN_*` env vars if the tenant hasn't set up their own.
4. On delivery failure, leaves the row `QUEUED` with a backoff `nextRetryAt`; `services/notification-retry.ts` sweeps these on an interval so nothing is silently dropped.

Staff manage SMS provider credentials from Settings (`GET`/`PUT /settings/sms`, `POST /settings/sms/test`), and message templates/delivery history from the separate Notifications page (`/notification-templates`, `/notification-logs`) — all in `routes/notifications.ts`. Credentials are encrypted at rest with the same key used for router credentials (`PROVISIONING_CREDENTIAL_KEY`).

## Security model

- Staff routes require a bearer token and are scoped to the staff member's tenant.
- Customer routes use separate customer authentication.
- The analyst is read-only by design; existing staff tools execute changes explicitly.
- Before production, restrict CORS, use HTTPS, store `JWT_SECRET` in a secret manager, and encrypt router API secrets at rest.

## Admin authentication & RBAC

- **Roles** (`lib/db/src/schema/users.ts`): `SUPER_ADMIN` (platform-wide, all tenants), `BUSINESS_OWNER`, `STAFF`, `TECHNICIAN`, `RESELLER` — all tenant-scoped. `requireRole(...)` in `middlewares/auth.ts` gates routes by role.
- **Self-registration** (`POST /auth/register`): creates a tenant + owner account with `status: PENDING_APPROVAL` and no role. It cannot log in until approved. A Super Admin can approve any tenant's pending users (`GET /auth/pending-users`, `POST /auth/approve-user`, `POST /auth/reject-user`); a Business Owner can only approve within their own tenant.
- **Trusted bootstrap** (`POST /auth/signup`, `scripts/src/seed-initial-tenant.ts`): creates an active owner/admin immediately, no approval step. Use this to stand up the first tenant/Super Admin, not for public sign-ups.
- **Account lockout**: 5 failed password attempts locks the account for 15 minutes (`failedLoginAttempts` / `lockedUntil` on `users`).
- **Rate limiting**: per-IP limits on login, register, forgot-password, and 2FA verification (`middlewares/rate-limit.ts`).
- **2FA**: optional TOTP (`POST /auth/2fa/setup`, `/verify`, `/disable`). When enabled, `POST /auth/login` returns `{ requires2FA: true, tempToken }` instead of tokens; complete with `POST /auth/login/2fa`.
- **Sessions/devices**: each refresh token records `userAgent`/`ipAddress`/`lastUsedAt`. List with `GET /auth/sessions`, revoke one with `POST /auth/sessions/:id/revoke`.
- **Password reset**: `POST /auth/forgot-password` / `POST /auth/reset-password`, backed by `password_reset_tokens`. Resetting a password revokes all of that user's sessions.
- **Audit log**: `audit_logs` table records logins (success/failure/lockout), registrations, password resets, 2FA changes, session revocations, and approvals via `lib/audit-log.ts`.
- **Not yet built**: email delivery for staff verification and reset codes (needs a real provider — see `.env.example`). Frontend for login/register/forgot-password/setup-wizard is now in place (see below). Tenant-facing gateway configuration is fully wired: SMS (Texin) via `GET`/`PUT /settings/sms` + `POST /settings/sms/test`, and M-Pesa/Daraja per-tenant via `GET`/`PUT /settings/mpesa` (`routes/tenants.ts`) — a tenant's own Paybill/Till credentials, stored encrypted in `tenant_mpesa_settings`, take priority over the deployment-wide `MPESA_*` env vars (`lib/mpesa-config.ts::resolveMpesaCredentials`), which remain the fallback for tenants who haven't configured their own.

### Admin Settings page (`/settings`)
A multi-section page (`?section=...`, panel components in `components/settings/`) covering: **General**, **Tenant Information** / **Branding** (company name/logo — `GET`/`PATCH /tenant`, `TenantPanels.tsx`), **Payment Methods** (per-tenant M-Pesa Paybill/Till credentials — `PaymentMethodsPanel.tsx`, `GET`/`PUT /settings/mpesa`), **Notifications** (SMS gateway config + test-send — `NotificationsPanel.tsx`, `GET`/`PUT /settings/sms`, `POST /settings/sms/test`), **AI NOC** (`NocSettingsPanel.tsx`), **Routers** / **Customer Portal** / **Authentication** / **Security** / **Billing** / **System** (read-only informational panels — `InfoPanels.tsx`, `GET /settings/system`), **Loyalty Points** / **Wallet** (tenant-wide loyalty aggregates — `LoyaltyPanel.tsx`, `GET /settings/loyalty-overview`), and **Backup & Restore** / **Integrations** (`ComingSoon.tsx` placeholders — not yet built). All editable sections are gated in the UI to `SUPER_ADMIN`/`BUSINESS_OWNER` (matching each route's `requireRole`); since there's no route-level role guard in `App.tsx` (only the nav link is hidden), a directly-navigated `staff`/`technician`/`reseller` account gets a read-only view instead of a form that would 403 on save. Frontend calls go through `src/lib/settings-api.ts`.

### Admin frontend pages added
`/login` (redesigned, glass card, 2FA-aware), `/register` (multi-step self-registration), `/forgot-password`, `/reset-password`, `/pending-approvals` (Super Admin/Business Owner review queue), `/setup` (first-login wizard). These call the new endpoints directly via `src/lib/auth-api.ts` (hand-written fetch helpers) since they aren't in the generated OpenAPI client yet — re-run Orval codegen once `lib/api-spec/openapi.yaml` is updated with these paths to get typed react-query hooks instead.

## Deployment

See `DEPLOYMENT.md` and `.env.example`. You need PostgreSQL, a persistent API process, database schema setup, RouterOS API access, and customised Hotspot files.
