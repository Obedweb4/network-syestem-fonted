import { and, eq, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  subscriptionsTable, customersTable, servicePlansTable, routersTable,
  provisioningMappingsTable, provisioningAuditLogsTable, subscriptionStatusHistoryTable,
  routerAlertsTable, type Subscription, type Customer, type ServicePlan, type Router,
  type ProvisioningMapping, type subscriptionStatusEnum,
} from "@workspace/db/schema";
import { MikroTikClient, SubscriptionProvisioningService, HotspotDeviceBindingService, normalizeMac, type SubscriptionDetails, type BindDeviceResult } from "@workspace/mikrotik";
import { generateRouterCredentials, generatePassword, encryptCredential, decryptCredential } from "../lib/provisioning-credentials";
import { queueCustomerNotification } from "../lib/notify";
import { logger } from "../lib/logger";

export const MAX_PROVISIONING_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 60_000; // 1 minute
const RETRY_MAX_DELAY_MS = 60 * 60_000; // 1 hour cap

export interface EngineActor {
  /** Staff user who triggered this action, for subscription_status_history / audit; omitted for system-triggered actions (payment callback, expiry sweep, retry sweep). */
  userId?: string;
}

export interface EngineOutcome {
  success: boolean;
  subscriptionId: string;
  error?: string;
  errorCode?: string;
  /** Present only immediately after resetSubscriberPassword — the plaintext is never stored or logged, only returned once. */
  password?: string;
}

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

interface LoadedSubscription {
  subscription: Subscription;
  customer: Customer;
  plan: ServicePlan;
  mapping?: ProvisioningMapping;
}

async function loadSubscription(subscriptionId: string): Promise<LoadedSubscription | null> {
  const [row] = await db.select({ subscription: subscriptionsTable, customer: customersTable, plan: servicePlansTable })
    .from(subscriptionsTable)
    .innerJoin(customersTable, eq(customersTable.id, subscriptionsTable.customerId))
    .innerJoin(servicePlansTable, eq(servicePlansTable.id, subscriptionsTable.planId))
    .where(eq(subscriptionsTable.id, subscriptionId))
    .limit(1);
  if (!row) return null;

  const [mapping] = await db.select().from(provisioningMappingsTable).where(eq(provisioningMappingsTable.subscriptionId, subscriptionId)).limit(1);
  return { subscription: row.subscription, customer: row.customer, plan: row.plan, mapping };
}

/** Explicit assignment first, else the customer's site router, else the tenant's oldest active router. */
async function resolveRouter(customer: Customer, explicitRouterId?: string | null): Promise<Router | undefined> {
  if (explicitRouterId) {
    const [r] = await db.select().from(routersTable).where(and(eq(routersTable.id, explicitRouterId), eq(routersTable.tenantId, customer.tenantId))).limit(1);
    if (r) return r;
  }
  if (customer.siteId) {
    const [siteRouter] = await db.select().from(routersTable).where(and(
      eq(routersTable.tenantId, customer.tenantId), eq(routersTable.siteId, customer.siteId), eq(routersTable.isActive, true),
    )).limit(1);
    if (siteRouter) return siteRouter;
  }
  const [anyRouter] = await db.select().from(routersTable).where(and(
    eq(routersTable.tenantId, customer.tenantId), eq(routersTable.isActive, true),
  )).orderBy(routersTable.createdAt).limit(1);
  return anyRouter;
}

function buildService(router: Router): { client: MikroTikClient; service: SubscriptionProvisioningService } {
  const client = new MikroTikClient({
    id: router.id, tenantId: router.tenantId, name: router.name,
    ipAddress: router.ipAddress, apiPort: router.apiPort ?? 8728,
    apiUsername: router.apiUsername, apiSecret: router.apiSecret,
  });
  const service = new SubscriptionProvisioningService(new Map([[router.id, client]]), { info: (m) => logger.info(m), error: (m) => logger.error(m) });
  return { client, service };
}

function buildBindingService(router: Router): { client: MikroTikClient; binding: HotspotDeviceBindingService } {
  const client = new MikroTikClient({
    id: router.id, tenantId: router.tenantId, name: router.name,
    ipAddress: router.ipAddress, apiPort: router.apiPort ?? 8728,
    apiUsername: router.apiUsername, apiSecret: router.apiSecret,
  });
  return { client, binding: new HotspotDeviceBindingService(client) };
}

function toSubscriptionDetails(subscription: Subscription, customer: Customer, plan: ServicePlan, routerId: string): SubscriptionDetails {
  return {
    id: subscription.id,
    customerId: customer.id,
    customerName: `${customer.firstName} ${customer.lastName}`,
    customerPhone: customer.phone,
    planId: plan.id,
    plan: { id: plan.id, name: plan.name, type: plan.type, speedUpKbps: plan.speedUpKbps ?? 0, speedDownKbps: plan.speedDownKbps ?? 0, durationDays: plan.durationDays },
    routerId,
    status: "PENDING_PROVISION",
    startsAt: subscription.startsAt,
    expiresAt: subscription.expiresAt,
  };
}

async function recordStatusChange(subscriptionId: string, tenantId: string, from: (typeof subscriptionStatusEnum.enumValues)[number] | null, to: (typeof subscriptionStatusEnum.enumValues)[number], reason: string, actor?: EngineActor): Promise<void> {
  await db.insert(subscriptionStatusHistoryTable).values({
    tenantId, subscriptionId, fromStatus: from, toStatus: to, reason, actorUserId: actor?.userId,
  });
}

async function recordAudit(entry: {
  tenantId: string; subscriptionId: string; customerId: string; routerId: string;
  action: string; status: "SUCCESS" | "FAILED"; routerUsername?: string; errorCode?: string; errorMessage?: string; durationMs: number;
}): Promise<void> {
  await db.insert(provisioningAuditLogsTable).values(entry).catch((err) => logger.error({ err, entry }, "Failed to write provisioning_audit_logs row"));
}

function nextBackoff(attemptCount: number): Date | null {
  if (attemptCount >= MAX_PROVISIONING_ATTEMPTS) return null; // give up scheduling further retries
  const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attemptCount - 1), RETRY_MAX_DELAY_MS);
  return new Date(Date.now() + delay);
}

async function raiseAlert(routerId: string, message: string, severity: "WARN" | "CRITICAL" = "WARN"): Promise<void> {
  await db.insert(routerAlertsTable).values({ routerId, alertType: "PROVISIONING_FAILED", severity, message }).catch((err) => logger.error({ err }, "Failed to record router alert"));
}

// ---------------------------------------------------------------------------
// MAC/IP device binding (RouterOS-native "no credentials" hotspot access)
// ---------------------------------------------------------------------------

/**
 * Idempotently grants a HOTSPOT subscriber's device network access via a
 * bypassed `/ip/hotspot/ip-binding` entry, keyed on the MAC captured at
 * checkout. This is the mechanism that lets "payment succeeded" translate
 * directly into "device is online" with zero username/password ever
 * generated or shown to the customer.
 *
 * No-ops (returns success without touching the router) when:
 * - the plan is PPPOE (MAC binding is a HOTSPOT-only concept — PPPoE auth
 *   happens at the PPP layer, not via the Hotspot walled garden), or
 * - there is no MAC to bind yet (customer paid through a channel — e.g.
 *   the app-based customer-portal on an already-authorized connection —
 *   that never captured one; the existing hotspot-user/voucher path still
 *   works for that customer as a fallback).
 *
 * Safe to call repeatedly (retry sweep, duplicate webhook delivery, manual
 * "reconcile" action) — always re-checks router state by MAC before acting.
 */
async function ensureDeviceBinding(
  subscriptionId: string,
  tenantId: string,
  customerId: string,
  planType: "PPPOE" | "HOTSPOT",
  router: Router,
  mapping: ProvisioningMapping,
  macAddress: string | null | undefined,
): Promise<void> {
  if (planType !== "HOTSPOT") return;

  const targetMac = normalizeMac(macAddress) ?? normalizeMac(mapping.boundMacAddress);
  if (!targetMac) {
    // Nothing to bind yet; leave status as-is (NOT_APPLICABLE/PENDING) so a
    // later payment that *does* carry a MAC can still trigger binding.
    return;
  }

  // A different device paid this time (e.g. customer switched phones) —
  // release the old binding first so exactly one device is ever authorized
  // per subscription at a time.
  const previousMac = normalizeMac(mapping.boundMacAddress);
  if (previousMac && previousMac !== targetMac) {
    await releaseDeviceBinding(router, previousMac, "remove");
  }

  const startedAt = Date.now();
  const { client, binding } = buildBindingService(router);
  let result: BindDeviceResult;
  try {
    result = await binding.bind({ macAddress: targetMac, comment: `PulseNet subscription ${subscriptionId}` });
    if (result.success) await binding.disconnectActiveSession(targetMac);
  } finally {
    await client.disconnect();
  }

  await recordAudit({
    tenantId, subscriptionId, customerId, routerId: router.id,
    action: "BIND_DEVICE", status: result.success ? "SUCCESS" : "FAILED",
    routerUsername: targetMac, errorCode: result.errorCode, errorMessage: result.error,
    durationMs: Date.now() - startedAt,
  });

  const attemptCount = (mapping.ipBindingAttemptCount ?? 0) + 1;
  await db.update(provisioningMappingsTable).set({
    boundMacAddress: targetMac,
    ipBindingStatus: result.success ? "BOUND" : "FAILED",
    ipBindingRouterEntryId: result.routerEntryId ?? mapping.ipBindingRouterEntryId,
    ipBindingAttemptCount: attemptCount,
    ipBindingNextRetryAt: result.success ? null : nextBackoff(attemptCount),
    ipBindingLastError: result.error ?? null,
    ipBindingLastErrorCode: result.errorCode ?? null,
    ipBindingBoundAt: result.success ? new Date() : mapping.ipBindingBoundAt,
    updatedAt: new Date(),
  }).where(eq(provisioningMappingsTable.id, mapping.id));

  if (result.success) {
    logger.info({ subscriptionId, routerId: router.id, mac: targetMac }, "Device bound for credential-free Hotspot access");
  } else {
    logger.error({ subscriptionId, routerId: router.id, mac: targetMac, error: result.error, attemptCount }, "Device binding failed");
    if (attemptCount === 1 || attemptCount >= MAX_PROVISIONING_ATTEMPTS) {
      await raiseAlert(router.id, `Failed to bind device ${targetMac} for subscription ${subscriptionId} after ${attemptCount} attempt(s): ${result.error ?? "unknown error"}. Customer's hotspot account may exist but their device cannot get online automatically.`, attemptCount >= MAX_PROVISIONING_ATTEMPTS ? "CRITICAL" : "WARN");
    }
  }
}

/** Disables (suspend/expire — reversible) or permanently removes (deprovision, or MAC changed) an existing device binding. Best-effort: logged, never thrown, since a router being unreachable must not block a billing-state change that already happened. */
async function releaseDeviceBinding(router: Router, macAddress: string, mode: "disable" | "remove"): Promise<void> {
  const mac = normalizeMac(macAddress);
  if (!mac) return;
  const { client, binding } = buildBindingService(router);
  try {
    const result = mode === "disable" ? await binding.disable(mac) : await binding.remove(mac);
    if (result.success) await binding.disconnectActiveSession(mac);
    if (!result.success) logger.error({ routerId: router.id, mac, mode, error: result.error }, "Failed to release device binding (billing state already changed; will be reconciled on next successful router contact)");
  } catch (err) {
    logger.error({ err, routerId: router.id, mac, mode }, "Unexpected error releasing device binding");
  } finally {
    await client.disconnect();
  }
}

// ---------------------------------------------------------------------------
// Provision (create, or heal an existing FAILED/DEPROVISIONED mapping)
// ---------------------------------------------------------------------------

/**
 * Idempotent: safe to call for a subscription that's already provisioned
 * (no-op), suspended (delegates to reactivate), failed (retries with the
 * same credentials), or never provisioned (creates fresh). This is the one
 * function every entry point — subscription creation, payment activation,
 * the retry sweep — calls to "make network access match billing state".
 */
export async function provisionSubscription(subscriptionId: string, actor?: EngineActor, macAddress?: string | null): Promise<EngineOutcome> {
  const loaded = await loadSubscription(subscriptionId);
  if (!loaded) return { success: false, subscriptionId, error: "Subscription not found", errorCode: "NOT_FOUND" };
  const { subscription, customer, plan, mapping } = loaded;

  if (mapping?.status === "SUCCESS") {
    // Router account already exists — still make sure the device itself is
    // bound (first payment with a MAC, a retry of a previously-failed
    // binding, or a returning customer paying from a new device all land
    // here). This is what makes "successful payment -> device online" work
    // even when nothing about the hotspot-user account needs to change.
    const router = await resolveRouter(customer, subscription.routerId ?? mapping.routerId);
    if (router) await ensureDeviceBinding(subscriptionId, subscription.tenantId, customer.id, plan.type, router, mapping, macAddress);
    return { success: true, subscriptionId };
  }
  if (mapping?.status === "SUSPENDED") return reactivateSubscription(subscriptionId, actor, macAddress);

  const router = await resolveRouter(customer, subscription.routerId ?? mapping?.routerId);
  if (!router) {
    logger.error({ subscriptionId, customerId: customer.id }, "No active router available to provision this subscription");
    if (mapping?.routerId) await raiseAlert(mapping.routerId, `No active router available for subscription ${subscriptionId} (${customer.firstName} ${customer.lastName})`, "CRITICAL");
    return { success: false, subscriptionId, error: "No active router available for this customer's tenant/site", errorCode: "NO_ROUTER" };
  }

  // Reuse the existing username/password on a retry (don't silently rotate a
  // customer's credentials just because the first attempt failed); mint
  // fresh ones only for a subscription that's never had a mapping.
  const username = mapping?.routerUsername ?? generateRouterCredentials(customer, subscription.id).username;
  const password = mapping?.pppoePasswordEncrypted ? decryptCredential(mapping.pppoePasswordEncrypted) : generatePassword();

  const { client, service } = buildService(router);
  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof service.provision>>;
  try {
    result = await service.provision(toSubscriptionDetails(subscription, customer, plan, router.id), { username, password });
  } finally {
    await client.disconnect();
  }

  const profileName = service.getProfileName({ id: plan.id, name: plan.name, type: plan.type, speedUpKbps: plan.speedUpKbps ?? 0, speedDownKbps: plan.speedDownKbps ?? 0, durationDays: plan.durationDays });
  const attemptCount = (mapping?.attemptCount ?? 0) + 1;

  let currentMapping: ProvisioningMapping;
  if (mapping) {
    [currentMapping] = await db.update(provisioningMappingsTable).set({
      routerId: router.id, routerUsername: result.routerUsername ?? username,
      pppoePasswordEncrypted: encryptCredential(password), pppoePasswordUpdatedAt: new Date(),
      mikrotikProfileName: profileName, status: result.success ? "SUCCESS" : "FAILED",
      attemptCount, nextRetryAt: result.success ? null : nextBackoff(attemptCount),
      lastProvisioningAttempt: new Date(), lastProvisioningError: result.error, lastProvisioningErrorCode: result.errorCode,
      provisionedAt: result.success ? new Date() : mapping.provisionedAt, updatedAt: new Date(),
    }).where(eq(provisioningMappingsTable.id, mapping.id)).returning();
  } else {
    [currentMapping] = await db.insert(provisioningMappingsTable).values({
      tenantId: subscription.tenantId, subscriptionId, customerId: customer.id, routerId: router.id,
      routerUsername: result.routerUsername ?? username, pppoePasswordEncrypted: encryptCredential(password), pppoePasswordUpdatedAt: new Date(),
      mikrotikProfileName: profileName, status: result.success ? "SUCCESS" : "FAILED",
      attemptCount, nextRetryAt: result.success ? null : nextBackoff(attemptCount),
      ipBindingStatus: plan.type === "HOTSPOT" ? "PENDING" : "NOT_APPLICABLE",
      lastProvisioningAttempt: new Date(), lastProvisioningError: result.error, lastProvisioningErrorCode: result.errorCode,
      provisionedAt: result.success ? new Date() : undefined,
    }).returning();
  }

  await recordAudit({
    tenantId: subscription.tenantId, subscriptionId, customerId: customer.id, routerId: router.id,
    action: "PROVISION", status: result.success ? "SUCCESS" : "FAILED", routerUsername: result.routerUsername ?? username,
    errorCode: result.errorCode, errorMessage: result.error, durationMs: Date.now() - startedAt,
  });

  // Device binding is independent of the hotspot-user/password outcome
  // above (that account is now only a fallback for the voucher/manual-login
  // section) — attempt it whenever a MAC is available so a device gets
  // online even if, say, the fallback user step hit a transient error.
  if (plan.type === "HOTSPOT") {
    await ensureDeviceBinding(subscriptionId, subscription.tenantId, customer.id, plan.type, router, currentMapping, macAddress);
  }

  if (result.success) {
    if (subscription.routerId !== router.id) await db.update(subscriptionsTable).set({ routerId: router.id, updatedAt: new Date() }).where(eq(subscriptionsTable.id, subscriptionId));
    if (subscription.status !== "ACTIVE") {
      await db.update(subscriptionsTable).set({ status: "ACTIVE", updatedAt: new Date() }).where(eq(subscriptionsTable.id, subscriptionId));
      await recordStatusChange(subscriptionId, subscription.tenantId, subscription.status, "ACTIVE", "Provisioning succeeded", actor);
    }
    await queueCustomerNotification(customer, "internet_activated", { planName: plan.name });
    logger.info({ subscriptionId, routerId: router.id, username: result.routerUsername }, `${plan.type} subscriber provisioned`);
    return { success: true, subscriptionId };
  }

  logger.error({ subscriptionId, routerId: router.id, error: result.error, attemptCount }, "Provisioning failed");
  if (attemptCount === 1 || attemptCount >= MAX_PROVISIONING_ATTEMPTS) {
    await raiseAlert(router.id, `Failed to provision ${plan.type} access for subscription ${subscriptionId} (${customer.firstName} ${customer.lastName}) after ${attemptCount} attempt(s): ${result.error ?? "unknown error"}`, attemptCount >= MAX_PROVISIONING_ATTEMPTS ? "CRITICAL" : "WARN");
  }
  return { success: false, subscriptionId, error: result.error, errorCode: result.errorCode };
}

// ---------------------------------------------------------------------------
// Suspend / Reactivate / Deprovision
// ---------------------------------------------------------------------------

/**
 * Disables the router account and disconnects any live session — used for
 * staff-initiated suspension, billing going OVERDUE, and subscription
 * expiry alike; `targetStatus` records *why* in subscriptions.status while
 * the router-side action is identical in every case.
 */
export async function suspendSubscription(subscriptionId: string, reason: string, targetStatus: "SUSPENDED" | "OVERDUE" | "EXPIRED" = "SUSPENDED", actor?: EngineActor): Promise<EngineOutcome> {
  const loaded = await loadSubscription(subscriptionId);
  if (!loaded) return { success: false, subscriptionId, error: "Subscription not found", errorCode: "NOT_FOUND" };
  const { subscription, customer, plan, mapping } = loaded;

  if (!mapping || mapping.status !== "SUCCESS") {
    // Hotspot-user account isn't in a healthy state, but the device may
    // still be bound directly (binding succeeds/fails independently of the
    // fallback user account — see ensureDeviceBinding) — revoke that too.
    if (mapping?.boundMacAddress && plan.type === "HOTSPOT" && mapping.ipBindingStatus === "BOUND") {
      const [router] = await db.select().from(routersTable).where(eq(routersTable.id, mapping.routerId)).limit(1);
      if (router) {
        await releaseDeviceBinding(router, mapping.boundMacAddress, "disable");
        await db.update(provisioningMappingsTable).set({ ipBindingStatus: "SUSPENDED", updatedAt: new Date() }).where(eq(provisioningMappingsTable.id, mapping.id));
      }
    }
    // Nothing provisioned to disable on the router — just reflect the billing status.
    if (subscription.status !== targetStatus) {
      await db.update(subscriptionsTable).set({ status: targetStatus, updatedAt: new Date() }).where(eq(subscriptionsTable.id, subscriptionId));
      await recordStatusChange(subscriptionId, subscription.tenantId, subscription.status, targetStatus, reason, actor);
    }
    return { success: true, subscriptionId };
  }

  const [router] = await db.select().from(routersTable).where(eq(routersTable.id, mapping.routerId)).limit(1);
  if (!router) return { success: false, subscriptionId, error: "Provisioned router no longer exists", errorCode: "ROUTER_NOT_FOUND" };

  const { client, service } = buildService(router);
  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof service.suspend>>;
  try {
    result = await service.suspend(subscriptionId, customer.id, router.id, mapping.routerUsername, plan.type);
    if (result.success) await disconnectLiveSessions(router, mapping.routerUsername, plan.type);
  } finally {
    await client.disconnect();
  }

  await recordAudit({
    tenantId: subscription.tenantId, subscriptionId, customerId: customer.id, routerId: router.id,
    action: "SUSPEND", status: result.success ? "SUCCESS" : "FAILED", routerUsername: mapping.routerUsername,
    errorCode: result.errorCode, errorMessage: result.error, durationMs: Date.now() - startedAt,
  });

  if (!result.success) {
    logger.error({ subscriptionId, error: result.error }, "Suspension failed; billing status left unchanged so it can be retried");
    await raiseAlert(router.id, `Failed to suspend subscription ${subscriptionId} (${customer.firstName} ${customer.lastName}): ${result.error ?? "unknown error"}`);
    return { success: false, subscriptionId, error: result.error, errorCode: result.errorCode };
  }

  await db.update(provisioningMappingsTable).set({ status: "SUSPENDED", updatedAt: new Date() }).where(eq(provisioningMappingsTable.id, mapping.id));
  if (plan.type === "HOTSPOT" && mapping.boundMacAddress) {
    await releaseDeviceBinding(router, mapping.boundMacAddress, "disable");
    await db.update(provisioningMappingsTable).set({ ipBindingStatus: "SUSPENDED", updatedAt: new Date() }).where(eq(provisioningMappingsTable.id, mapping.id));
  }
  if (subscription.status !== targetStatus) {
    await db.update(subscriptionsTable).set({ status: targetStatus, updatedAt: new Date() }).where(eq(subscriptionsTable.id, subscriptionId));
    await recordStatusChange(subscriptionId, subscription.tenantId, subscription.status, targetStatus, reason, actor);
  }
  await queueCustomerNotification(customer, "suspension", { reason });
  logger.info({ subscriptionId, targetStatus, reason }, "Subscriber suspended");
  return { success: true, subscriptionId };
}

/** Re-enables a suspended subscriber's existing router account. If nothing was ever provisioned, provisions fresh instead. */
export async function reactivateSubscription(subscriptionId: string, actor?: EngineActor, macAddress?: string | null): Promise<EngineOutcome> {
  const loaded = await loadSubscription(subscriptionId);
  if (!loaded) return { success: false, subscriptionId, error: "Subscription not found", errorCode: "NOT_FOUND" };
  const { subscription, customer, plan, mapping } = loaded;

  if (!mapping || mapping.status === "DEPROVISIONED") return provisionSubscription(subscriptionId, actor, macAddress);
  if (mapping.status === "SUCCESS") {
    if (subscription.status !== "ACTIVE") {
      await db.update(subscriptionsTable).set({ status: "ACTIVE", updatedAt: new Date() }).where(eq(subscriptionsTable.id, subscriptionId));
      await recordStatusChange(subscriptionId, subscription.tenantId, subscription.status, "ACTIVE", "Already provisioned; billing status corrected", actor);
    }
    const router = await resolveRouter(customer, subscription.routerId ?? mapping.routerId);
    if (router) await ensureDeviceBinding(subscriptionId, subscription.tenantId, customer.id, plan.type, router, mapping, macAddress);
    return { success: true, subscriptionId };
  }
  if (mapping.status === "FAILED") return provisionSubscription(subscriptionId, actor, macAddress);

  const [router] = await db.select().from(routersTable).where(eq(routersTable.id, mapping.routerId)).limit(1);
  if (!router) return { success: false, subscriptionId, error: "Provisioned router no longer exists", errorCode: "ROUTER_NOT_FOUND" };

  const { client, service } = buildService(router);
  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof service.resume>>;
  try {
    result = await service.resume(subscriptionId, customer.id, router.id, mapping.routerUsername, plan.type);
  } finally {
    await client.disconnect();
  }

  await recordAudit({
    tenantId: subscription.tenantId, subscriptionId, customerId: customer.id, routerId: router.id,
    action: "RESUME", status: result.success ? "SUCCESS" : "FAILED", routerUsername: mapping.routerUsername,
    errorCode: result.errorCode, errorMessage: result.error, durationMs: Date.now() - startedAt,
  });

  if (!result.success) {
    await raiseAlert(router.id, `Failed to reactivate subscription ${subscriptionId} (${customer.firstName} ${customer.lastName}): ${result.error ?? "unknown error"}`);
    return { success: false, subscriptionId, error: result.error, errorCode: result.errorCode };
  }

  const [reactivatedMapping] = await db.update(provisioningMappingsTable).set({ status: "SUCCESS", updatedAt: new Date() }).where(eq(provisioningMappingsTable.id, mapping.id)).returning();
  await db.update(subscriptionsTable).set({ status: "ACTIVE", updatedAt: new Date() }).where(eq(subscriptionsTable.id, subscriptionId));
  await recordStatusChange(subscriptionId, subscription.tenantId, subscription.status, "ACTIVE", "Reactivated", actor);

  if (plan.type === "HOTSPOT") {
    await ensureDeviceBinding(subscriptionId, subscription.tenantId, customer.id, plan.type, router, reactivatedMapping ?? mapping, macAddress);
  }

  await queueCustomerNotification(customer, "reactivation");
  logger.info({ subscriptionId }, "Subscriber reactivated");
  return { success: true, subscriptionId };
}

/** Permanently removes the router account (subscription cancellation). The mapping row is kept, marked DEPROVISIONED, for audit history. */
export async function deprovisionSubscription(subscriptionId: string, reason: string, actor?: EngineActor): Promise<EngineOutcome> {
  const loaded = await loadSubscription(subscriptionId);
  if (!loaded) return { success: false, subscriptionId, error: "Subscription not found", errorCode: "NOT_FOUND" };
  const { subscription, customer, mapping } = loaded;

  if (mapping && mapping.status !== "DEPROVISIONED") {
    const [router] = await db.select().from(routersTable).where(eq(routersTable.id, mapping.routerId)).limit(1);
    if (router) {
      const { client, service } = buildService(router);
      const startedAt = Date.now();
      let result: Awaited<ReturnType<typeof service.deprovision>>;
      try {
        result = await service.deprovision(subscriptionId, customer.id, router.id, mapping.routerUsername, loaded.plan.type);
      } finally {
        await client.disconnect();
      }
      await recordAudit({
        tenantId: subscription.tenantId, subscriptionId, customerId: customer.id, routerId: router.id,
        action: "DEPROVISION", status: result.success ? "SUCCESS" : "FAILED", routerUsername: mapping.routerUsername,
        errorCode: result.errorCode, errorMessage: result.error, durationMs: Date.now() - startedAt,
      });
      if (!result.success) {
        await raiseAlert(router.id, `Failed to deprovision subscription ${subscriptionId}: ${result.error ?? "unknown error"}`);
        return { success: false, subscriptionId, error: result.error, errorCode: result.errorCode };
      }
      if (loaded.plan.type === "HOTSPOT" && mapping.boundMacAddress && mapping.ipBindingStatus !== "REMOVED") {
        await releaseDeviceBinding(router, mapping.boundMacAddress, "remove");
      }
      await db.update(provisioningMappingsTable).set({
        status: "DEPROVISIONED", deprovisionedAt: new Date(), updatedAt: new Date(),
        ipBindingStatus: loaded.plan.type === "HOTSPOT" ? "REMOVED" : mapping.ipBindingStatus,
      }).where(eq(provisioningMappingsTable.id, mapping.id));
    }
  }

  await db.update(subscriptionsTable).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(subscriptionsTable.id, subscriptionId));
  await recordStatusChange(subscriptionId, subscription.tenantId, subscription.status, "CANCELLED", reason, actor);
  await queueCustomerNotification(customer, "subscription_cancelled", { reason });
  return { success: true, subscriptionId };
}

/** Terminates every live session for a router account without touching its enabled/disabled state — called after suspend() so an already-connected customer is actually cut off, not just blocked from reconnecting. */
async function disconnectLiveSessions(router: Router, routerUsername: string, planType: "PPPOE" | "HOTSPOT"): Promise<void> {
  const client = new MikroTikClient({ id: router.id, tenantId: router.tenantId, name: router.name, ipAddress: router.ipAddress, apiPort: router.apiPort ?? 8728, apiUsername: router.apiUsername, apiSecret: router.apiSecret });
  try {
    const connect = await client.connect();
    if (!connect.success) return;
    const path = planType === "HOTSPOT" ? "/ip/hotspot/active" : "/ppp/active";
    const result = await client.run(path, "print", { user: routerUsername });
    const sessions = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
    for (const s of sessions as Record<string, unknown>[]) {
      const id = s[".id"] as string | undefined;
      if (id) await client.run(path, "remove", { numbers: id });
    }
  } catch (err) {
    logger.error({ err, routerUsername }, "Failed to terminate live sessions after suspend (account is still disabled, so no new sessions can start)");
  } finally {
    await client.disconnect();
  }
}

// ---------------------------------------------------------------------------
// Reprovision: plan change, router change, or both (upgrade/downgrade)
// ---------------------------------------------------------------------------

export async function reprovisionSubscription(subscriptionId: string, changes: { newPlanId?: string; newRouterId?: string }, actor?: EngineActor): Promise<EngineOutcome> {
  const loaded = await loadSubscription(subscriptionId);
  if (!loaded) return { success: false, subscriptionId, error: "Subscription not found", errorCode: "NOT_FOUND" };
  const { subscription, customer, plan, mapping } = loaded;

  const newPlan = changes.newPlanId && changes.newPlanId !== plan.id
    ? (await db.select().from(servicePlansTable).where(eq(servicePlansTable.id, changes.newPlanId)).limit(1))[0]
    : plan;
  if (!newPlan) return { success: false, subscriptionId, error: "Target plan not found", errorCode: "PLAN_NOT_FOUND" };

  const targetRouter = await resolveRouter(customer, changes.newRouterId ?? subscription.routerId ?? mapping?.routerId);
  if (!targetRouter) return { success: false, subscriptionId, error: "No active router available for the target site", errorCode: "NO_ROUTER" };

  // Never provisioned yet: just point the subscription at the new plan/router and provision fresh.
  if (!mapping || mapping.status !== "SUCCESS") {
    await db.update(subscriptionsTable).set({ planId: newPlan.id, routerId: targetRouter.id, updatedAt: new Date() }).where(eq(subscriptionsTable.id, subscriptionId));
    return provisionSubscription(subscriptionId, actor);
  }

  const routerChanged = targetRouter.id !== mapping.routerId;
  const typeChanged = newPlan.type !== plan.type;

  if (!routerChanged && !typeChanged) {
    // Fast path: same router, same account type (PPPoE stays PPPoE) — just move the profile.
    const [router] = await db.select().from(routersTable).where(eq(routersTable.id, mapping.routerId)).limit(1);
    if (!router) return { success: false, subscriptionId, error: "Provisioned router no longer exists", errorCode: "ROUTER_NOT_FOUND" };
    const { client, service } = buildService(router);
    const startedAt = Date.now();
    let result: Awaited<ReturnType<typeof service.changePlan>>;
    try {
      result = await service.changePlan(subscriptionId, customer.id, router.id, mapping.routerUsername, { id: newPlan.id, name: newPlan.name, type: newPlan.type, speedUpKbps: newPlan.speedUpKbps ?? 0, speedDownKbps: newPlan.speedDownKbps ?? 0, durationDays: newPlan.durationDays }, newPlan.type);
    } finally {
      await client.disconnect();
    }
    await recordAudit({
      tenantId: subscription.tenantId, subscriptionId, customerId: customer.id, routerId: router.id,
      action: "CHANGE_PLAN", status: result.success ? "SUCCESS" : "FAILED", routerUsername: mapping.routerUsername,
      errorCode: result.errorCode, errorMessage: result.error, durationMs: Date.now() - startedAt,
    });
    if (!result.success) {
      await raiseAlert(router.id, `Failed to change plan for subscription ${subscriptionId}: ${result.error ?? "unknown error"}`);
      return { success: false, subscriptionId, error: result.error, errorCode: result.errorCode };
    }
    const profileName = service.getProfileName({ id: newPlan.id, name: newPlan.name, type: newPlan.type, speedUpKbps: newPlan.speedUpKbps ?? 0, speedDownKbps: newPlan.speedDownKbps ?? 0, durationDays: newPlan.durationDays });
    await db.update(provisioningMappingsTable).set({ mikrotikProfileName: profileName, updatedAt: new Date() }).where(eq(provisioningMappingsTable.id, mapping.id));
    await db.update(subscriptionsTable).set({ planId: newPlan.id, updatedAt: new Date() }).where(eq(subscriptionsTable.id, subscriptionId));
    await queueCustomerNotification(customer, "plan_changed", { planName: newPlan.name });
    return { success: true, subscriptionId };
  }

  // Router change and/or account-type change: must deprovision from the old
  // location before provisioning the new one. If the new provision fails
  // after a successful deprovision, the customer is left with no access at
  // all — that failure mode is raised as CRITICAL rather than hidden.
  const [oldRouter] = await db.select().from(routersTable).where(eq(routersTable.id, mapping.routerId)).limit(1);
  if (oldRouter) {
    const { client, service } = buildService(oldRouter);
    let deprovisionResult: Awaited<ReturnType<typeof service.deprovision>>;
    try {
      deprovisionResult = await service.deprovision(subscriptionId, customer.id, oldRouter.id, mapping.routerUsername, plan.type);
    } finally {
      await client.disconnect();
    }
    if (!deprovisionResult.success) {
      logger.error({ subscriptionId, error: deprovisionResult.error }, "Reprovision aborted: could not remove the subscriber from their current router");
      return { success: false, subscriptionId, error: `Could not remove existing account before moving: ${deprovisionResult.error}`, errorCode: deprovisionResult.errorCode };
    }
    if (plan.type === "HOTSPOT" && mapping.boundMacAddress && mapping.ipBindingStatus !== "REMOVED" && mapping.ipBindingStatus !== "NOT_APPLICABLE") {
      // Best-effort: don't abort the move over a stale binding cleanup —
      // worst case it's an inert bypassed entry for a MAC that's no longer
      // relevant on hardware the customer isn't assigned to anymore.
      await releaseDeviceBinding(oldRouter, mapping.boundMacAddress, "remove");
    }
  }

  await db.update(provisioningMappingsTable).set({ status: "DEPROVISIONED", deprovisionedAt: new Date(), updatedAt: new Date() }).where(eq(provisioningMappingsTable.id, mapping.id));
  await db.update(subscriptionsTable).set({ planId: newPlan.id, routerId: targetRouter.id, updatedAt: new Date() }).where(eq(subscriptionsTable.id, subscriptionId));

  const reprovisionResult = await provisionSubscription(subscriptionId, actor);
  if (!reprovisionResult.success) {
    await raiseAlert(targetRouter.id, `Subscription ${subscriptionId} (${customer.firstName} ${customer.lastName}) was removed from its old router but failed to provision on the new one — customer currently has NO network access. Manual intervention required.`, "CRITICAL");
  } else {
    if (routerChanged) {
      await queueCustomerNotification(customer, "router_changed", { routerName: targetRouter.name });
    } else {
      await queueCustomerNotification(customer, "plan_changed", { planName: newPlan.name });
    }
  }
  return reprovisionResult;
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function resetSubscriberPassword(subscriptionId: string, actor?: EngineActor): Promise<EngineOutcome> {
  const loaded = await loadSubscription(subscriptionId);
  if (!loaded) return { success: false, subscriptionId, error: "Subscription not found", errorCode: "NOT_FOUND" };
  const { subscription, customer, plan, mapping } = loaded;
  if (!mapping || mapping.status === "DEPROVISIONED") return { success: false, subscriptionId, error: "Subscriber is not currently provisioned", errorCode: "NOT_PROVISIONED" };

  const [router] = await db.select().from(routersTable).where(eq(routersTable.id, mapping.routerId)).limit(1);
  if (!router) return { success: false, subscriptionId, error: "Provisioned router no longer exists", errorCode: "ROUTER_NOT_FOUND" };

  const newPassword = generatePassword();
  const { client, service } = buildService(router);
  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof service.resetPassword>>;
  try {
    result = await service.resetPassword(subscriptionId, customer.id, router.id, mapping.routerUsername, newPassword, plan.type);
  } finally {
    await client.disconnect();
  }

  await recordAudit({
    tenantId: subscription.tenantId, subscriptionId, customerId: customer.id, routerId: router.id,
    action: "CHANGE_PASSWORD", status: result.success ? "SUCCESS" : "FAILED", routerUsername: mapping.routerUsername,
    errorCode: result.errorCode, errorMessage: result.error, durationMs: Date.now() - startedAt,
  });

  if (!result.success) return { success: false, subscriptionId, error: result.error, errorCode: result.errorCode };

  await db.update(provisioningMappingsTable).set({ pppoePasswordEncrypted: encryptCredential(newPassword), pppoePasswordUpdatedAt: new Date(), updatedAt: new Date() }).where(eq(provisioningMappingsTable.id, mapping.id));
  await queueCustomerNotification(customer, "password_reset_router");
  return { success: true, subscriptionId, password: newPassword };
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

export type BulkAction = "provision" | "suspend" | "reactivate" | "deprovision";

export async function bulkAction(subscriptionIds: string[], action: BulkAction, reason: string | undefined, actor?: EngineActor): Promise<Array<EngineOutcome>> {
  const results: EngineOutcome[] = [];
  // Sequential, not Promise.all: these hit real routers one at a time on
  // purpose, so a batch of 200 suspensions doesn't open 200 simultaneous
  // RouterOS API connections to the same box.
  for (const id of subscriptionIds) {
    try {
      if (action === "provision") results.push(await provisionSubscription(id, actor));
      else if (action === "suspend") results.push(await suspendSubscription(id, reason ?? "Bulk suspension", "SUSPENDED", actor));
      else if (action === "reactivate") results.push(await reactivateSubscription(id, actor));
      else results.push(await deprovisionSubscription(id, reason ?? "Bulk cancellation", actor));
    } catch (err) {
      logger.error({ err, subscriptionId: id, action }, "Bulk provisioning action threw unexpectedly");
      results.push({ success: false, subscriptionId: id, error: err instanceof Error ? err.message : String(err), errorCode: "UNEXPECTED_ERROR" });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Retry sweep support
// ---------------------------------------------------------------------------

/** Finds provisioning attempts that failed and are due for a retry (exponential backoff, capped at MAX_PROVISIONING_ATTEMPTS), and retries each via the same idempotent provisionSubscription() path. */
export async function retryFailedProvisioning(): Promise<void> {
  const now = new Date();
  const candidates = await db.select({ subscriptionId: provisioningMappingsTable.subscriptionId })
    .from(provisioningMappingsTable)
    .where(and(
      eq(provisioningMappingsTable.status, "FAILED"),
      lt(provisioningMappingsTable.attemptCount, MAX_PROVISIONING_ATTEMPTS),
      or(isNull(provisioningMappingsTable.nextRetryAt), lte(provisioningMappingsTable.nextRetryAt, now)),
    ));

  for (const c of candidates) {
    await provisionSubscription(c.subscriptionId).catch((err) => logger.error({ err, subscriptionId: c.subscriptionId }, "Provisioning retry threw unexpectedly"));
  }

  await retryFailedDeviceBindings();
}

/**
 * Separate retry pass for device bindings that failed independently of the
 * hotspot-user account (e.g. the account provisioned fine but the router
 * bounced the ip-binding `add` due to a transient error) — these subscriptions
 * won't show up in the query above because `provisioningMappingsTable.status`
 * is already SUCCESS, so they need their own candidate query keyed on
 * `ipBindingStatus` instead.
 */
async function retryFailedDeviceBindings(): Promise<void> {
  const now = new Date();
  const candidates = await db.select({ subscriptionId: provisioningMappingsTable.subscriptionId })
    .from(provisioningMappingsTable)
    .where(and(
      eq(provisioningMappingsTable.ipBindingStatus, "FAILED"),
      lt(provisioningMappingsTable.ipBindingAttemptCount, MAX_PROVISIONING_ATTEMPTS),
      or(isNull(provisioningMappingsTable.ipBindingNextRetryAt), lte(provisioningMappingsTable.ipBindingNextRetryAt, now)),
    ));

  for (const c of candidates) {
    // Re-enter through provisionSubscription with no new MAC — it will fall
    // back to the previously-recorded boundMacAddress on the mapping row.
    await provisionSubscription(c.subscriptionId).catch((err) => logger.error({ err, subscriptionId: c.subscriptionId }, "Device binding retry threw unexpectedly"));
  }
}

/** Starts a non-overlapping background sweep retrying failed provisioning attempts. */
export function startProvisioningRetrySweep(intervalMs = 120_000): void {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      await retryFailedProvisioning();
    } finally {
      running = false;
    }
  };
  void sweep();
  setInterval(() => void sweep(), intervalMs).unref();
}
