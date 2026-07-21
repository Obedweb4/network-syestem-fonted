# PulseNet AI NOC (Network Operations Center)

## Role

The AI NOC is a **distinct component from the AI Network Analyst** (see `AI_ANALYST_ROLE.md`, which remains accurate and unchanged — that panel is still purely read-only). The NOC continuously monitors router health, detects faults/anomalies/congestion trends, correlates outages, and generates recommendations — and, unlike the Analyst, it is permitted to *carry out* a narrow, fixed set of actions rather than only describe them. This document is the safety boundary for that broader permission; read it alongside `AI_ANALYST_ROLE.md` rather than treating the two as contradictory — they cover different components with different, explicitly-scoped mandates.

## What it may do without a human present

Only these three action types, and only when `noc_settings.auto_remediation_enabled` is explicitly turned on for a tenant (**off by default**):

- **Restart monitoring** for a router — resets the collector's own polling backoff and forces an immediate re-check. Touches nothing on the router or any customer account.
- **Retry provisioning** for a subscription — re-invokes the same idempotent, already-retried provisioning engine call that would otherwise run automatically anyway on its own backoff schedule, just sooner.
- **Disconnect an orphaned session** — drops a router session whose backing subscription is already EXPIRED/SUSPENDED/CANCELLED in billing. This corrects a drift between the router and the billing system; it does not create a new billing consequence.

## What always requires a staff member to approve

Reactivating a subscription, suspending a subscription, and moving a subscription to a different router — regardless of the auto-remediation setting. These appear as recommendations with a rationale and confidence score; a staff member reviews and clicks Approve (or Dismiss) before anything happens. The NOC has no path to execute these unattended.

## What it never does

Create a router, delete a router, change RouterOS credentials, issue refunds, alter billing amounts, or take any action outside the fixed allowlist above. The executor (`artifacts/api-server/src/services/noc-actions.ts`) switches on a closed set of action types and returns a "no handler" error for anything else — there is no default/fallback branch that executes unrecognized input.

## Safety mechanics (for reviewers)

- Risk level (SAFE vs. REQUIRES_APPROVAL vs. INFO_ONLY) is assigned from a hardcoded map keyed on action type (`artifacts/api-server/src/services/noc-shared.ts`) — never from anything a language model outputs, and re-derived independently at execution time rather than trusted from a stored database value.
- The optional LLM call (`noc-llm.ts`, requires `ANTHROPIC_API_KEY`) is used **only** to write human-readable narrative text (root-cause explanations, incident reports) from already-computed, already-verified structured data. It has no ability to trigger, parameterize, or influence which action runs.
- Every execution — human-approved or auto-run — is logged to `noc_incident_events` and reuses the same audited, idempotent functions from `provisioning-engine.ts` and `sessions.ts` that staff-initiated actions already use. No new mutation path was introduced for the NOC; it only gained a gated way to call the existing ones.
- `PUT /noc/settings` (the auto-remediation toggle) is restricted to `SUPER_ADMIN`/`BUSINESS_OWNER`.
