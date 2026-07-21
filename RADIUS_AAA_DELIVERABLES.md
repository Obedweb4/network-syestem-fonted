# PulseNet — RADIUS (AAA) Backend: Delivery Report

**Scope of this report:** only the work completed in this session — the
centralized RADIUS Authentication/Authorization/Accounting backend. It does
not re-describe the rest of PulseNet (billing, provisioning, NOC, etc.),
which already existed and was untouched.

---

## 1. What was already in place before this session

- `lib/db/src/schema/radius.ts` — `radius_server_config`, `radius_auth_events`,
  `radius_accounting` tables, plus the RADIUS-related columns already added
  to `routers` and `service_plans`.
- `lib/db/manual-sql/0008_radius_aaa.sql` — the corresponding hand-written
  SQL for that schema (additive-only, already reviewed/present).
- `lib/radius/src/codec.ts` — the full RFC 2865/2866/2869/5176 wire codec:
  packet decode/encode, response-authenticator signing, PAP decryption,
  CHAP verification, MikroTik vendor-specific attributes.
- `lib/radius/src/index.ts` was an empty file — nothing consumed the codec yet.

Everything below is new.

## 2. What was built this session

### 2.1 `@workspace/radius` library — AAA business logic

| File | Purpose |
|---|---|
| `lib/radius/src/nas-resolver.ts` | Resolves the sending NAS (router) and its tenant from a packet's UDP source IP; resolves which shared secret applies (router-specific, falling back to the tenant's default) and decrypts it. Short-lived in-process cache so an unrecognized/misconfigured source doesn't cost a DB round trip per retransmit. |
| `lib/radius/src/auth-service.ts` | `handleAccessRequest()` — the full Access-Request pipeline: looks up the subscriber's `provisioning_mappings` row by username, verifies PAP or CHAP against the same decrypted router password the MikroTik provisioning flow already set, checks the linked subscription's status (`ACTIVE`/`SUSPENDED`/`OVERDUE`/`EXPIRED`/`CANCELLED`), and on success builds an Access-Accept carrying Session-Timeout, Idle-Timeout, Framed-Pool, Mikrotik-Rate-Limit, Mikrotik-Address-List and Mikrotik-Group attributes sourced from the customer's plan (falling back to the tenant's RADIUS defaults). Every decision — accept or reject, with a machine-readable reason code — is written to `radius_auth_events`. |
| `lib/radius/src/accounting-service.ts` | `handleAccountingRequest()` — handles Start / Interim-Update / Stop against `radius_accounting`, keyed by `(routerId, acctSessionId)`. Idempotent against retransmits (`onConflictDoUpdate` / `onConflictDoNothing`), synthesizes a row from an orphaned Interim-Update if a Start was missed, and decodes `Acct-Terminate-Cause` into a readable label on Stop. Per RFC 2866, always ACKs if the packet parses — accounting has no reject concept — even when a downstream DB error occurs, so a NAS is never left retransmitting forever. |
| `lib/radius/src/coa-client.ts` | `sendDisconnectRequest()` — outbound RFC 5176 Disconnect-Request, for admin-triggered "kick this session" actions and for suspending a customer whose session is already up. |
| `lib/radius/src/index.ts` | Public export surface (codec + NAS resolver + auth/accounting services + CoA client), consumed by both the new UDP daemon and, where needed, `api-server`. |

### 2.2 `@workspace/radius-server` — the UDP server process

New package at `artifacts/radius-server/`, structured identically to the
existing `api-server` deployable (own `package.json`, `tsconfig.json`,
esbuild `build.mjs` copied from api-server's, `pino` logger):

| File | Purpose |
|---|---|
| `src/udp-server.ts` | Binds two independent `dgram` UDP sockets (auth + accounting). Every datagram: resolve the NAS by source IP → decode the packet → reject silently if the source isn't a recognized, RADIUS-enabled NAS (never reply to strangers) → dispatch to the auth or accounting handler → send the signed response back to the NAS. |
| `src/index.ts` | Process entrypoint. Reads `RADIUS_AUTH_PORT` (1812), `RADIUS_ACCT_PORT` (1813), `RADIUS_BIND_HOST` (0.0.0.0); fails fast if `PROVISIONING_CREDENTIAL_KEY` isn't set, since this process decrypts the same ciphertexts api-server does. |

**Design decision, stated explicitly:** this is one shared process/port-pair
serving every tenant, not one process per tenant. RADIUS has no
"tenant ID" field on the wire; a NAS's source IP already uniquely resolves
both the NAS and its tenant (a router row is tenant-scoped), so that's what
the resolver uses. `radius_server_config`'s per-tenant `authPort`/`acctPort`
columns remain informational/display fields ("point your NAS at
`<host>:<port>`") rather than something this process binds per-tenant —
this matches how every other multi-tenant RADIUS deployment (freeradius
included) handles the same constraint.

### 2.3 Admin API — `artifacts/api-server/src/routes/radius.ts` (new, wired into `routes/index.ts`)

All routes are tenant-scoped via the existing `requireAuth` middleware
(`req.user.tenantId`), matching every other route file in the app.

| Method & path | Role gate | Purpose |
|---|---|---|
| `GET /radius/config` | any authenticated staff | Tenant's RADIUS config; never returns the secret, only `hasDefaultSecret: boolean`. |
| `PUT /radius/config` | `SUPER_ADMIN`, `BUSINESS_OWNER` | Upsert config (enable/disable, ports, default session/idle timeout, framed pool, interim interval). A plaintext `defaultSecret` in the body is encrypted with the existing `@workspace/crypto` AES-256-GCM helper before storage — never stored or returned in plaintext. |
| `GET /radius/auth-events` | any authenticated staff | Recent Access-Accept/Reject audit log, filterable by result/router. |
| `GET /radius/sessions/online` | any authenticated staff | Currently-active RADIUS-accounted sessions (`status = ACTIVE`). |
| `GET /radius/sessions` | any authenticated staff | Session history, filterable by customer/status. |
| `GET /radius/overview` | any authenticated staff | Dashboard summary: online count, last-24h accept/reject counts, RADIUS-enabled NAS list with last-contact timestamps. |
| `POST /radius/sessions/disconnect` | `SUPER_ADMIN`, `BUSINESS_OWNER`, `STAFF`, `TECHNICIAN` | Sends a live RFC 5176 Disconnect-Request for one active session via `coa-client.ts`. Complements the existing `POST /sessions/:id/disconnect` (which talks to RouterOS directly) — this one is for subscribers actually authenticated through PulseNet's own RADIUS server. |

### 2.4 Docs and env

- `.env.example` — added `RADIUS_AUTH_PORT`, `RADIUS_ACCT_PORT`,
  `RADIUS_BIND_HOST`, with a note that the daemon reuses api-server's
  `DATABASE_URL`/`PROVISIONING_CREDENTIAL_KEY`.
- `DEPLOYMENT.md` — added the `pnpm --filter @workspace/radius-server build`
  step and a "RADIUS server — optional, separate process" section covering
  that it's a standalone long-running process, the UDP ports that must be
  opened on the firewall/load balancer, and that NAS↔tenant resolution
  depends on `routers.ipAddress` being each router's real, stable source
  address.

## 3. Update — Admin UI and OpenAPI (added after this doc was first written)

The two gaps originally called out below are now closed:

- **Admin UI** — `artifacts/admin/src/pages/radius.tsx` (tabs for Overview /
  Online Users / Auth Events, matching the existing `?view=` pattern used by
  `mikrotik-monitor.tsx`), wired into `App.tsx` (`/radius` route) and the
  sidebar (`components/layout/navigation.tsx`). It calls the six endpoints
  below directly via `customFetch` from `@workspace/api-client-react` (no
  generated hooks yet — see next point).
- **OpenAPI spec** — all six `/radius/*` routes are now described in
  `lib/api-spec/openapi.yaml` (tag `radius`, operation IDs
  `getRadiusConfig`, `updateRadiusConfig`, `listRadiusAuthEvents`,
  `listRadiusOnlineSessions`, `listRadiusSessions`, `getRadiusOverview`,
  `disconnectRadiusSession`), with request/response schemas matching the
  Drizzle tables and `coa-client.ts`'s actual return shape
  (`{ acked, nak, error }`). Re-run Orval codegen (`pnpm --filter
  @workspace/api-spec generate`, or whatever the repo's script is) to turn
  these into typed `api-zod`/`api-client-react` hooks — that hasn't been
  run here (see §4), so `radius.tsx` still uses `customFetch` directly
  rather than a generated hook. Swapping it over afterward is optional
  cleanup, not required for the page to work.

**Not built:** RADIUS session history surfaced in the *customer* portal —
still out of scope, unchanged from the original note below.

## 4. A note on verification

This sandbox has no network access (outbound requests are blocked at the
proxy level) and no `pnpm` binary, so `pnpm install` / `pnpm typecheck`
still cannot be run here — that hasn't changed. What was done instead:
every file (including the two additions in §3) was manually cross-checked
against the real Drizzle schema (`lib/db/src/schema/*.ts`), the codec's and
`coa-client.ts`'s actual exports/return shapes, and the exact import/response
conventions used elsewhere in the repo. The OpenAPI YAML was validated to
parse correctly. None of this substitutes for an actual `tsc --noEmit` run.
Please run `pnpm install && pnpm typecheck` (and `pnpm --filter
@workspace/api-spec generate` if you want the typed client) after pulling
this in — that's the step that still can't be done from this sandbox.
