import type { MikroTikResponse } from "../types";
import { MikroTikClient } from "../client";

/**
 * Hotspot Device (MAC/IP) Binding Service for PulseNet Billing
 *
 * Grants a customer's device Hotspot internet access via RouterOS's native
 * `/ip/hotspot/ip-binding` mechanism with `type=bypassed` — the device is
 * excluded from the Hotspot's login requirement entirely at the router
 * level. No username or password is ever created or shown for this path;
 * the mapping between "who paid" and "which device gets online" lives only
 * in this system's database and on the router's binding table.
 *
 * This is the RouterOS-native alternative to HotspotProvisioningService
 * (which creates a `/ip/hotspot/user` with a password). Both can coexist —
 * a bypassed binding wins over the login form for that MAC, so a customer
 * bound this way is never shown the captive page again while the binding
 * is active, regardless of whether a fallback user/password also exists
 * (e.g. for the "Already have a voucher?" section).
 *
 * Responsibilities:
 * - Idempotently create/update/remove `/ip/hotspot/ip-binding` entries
 * - Enable/disable a binding (suspend/resume) without losing router state
 * - Look up a binding's current state for reconciliation
 *
 * NOT responsible for:
 * - Database persistence (provisioning-engine.ts owns provisioning_mappings)
 * - Deciding which MAC belongs to which customer (billing/checkout layer)
 * - Hotspot user/profile/password management (see hotspot-provisioning.ts)
 */

export interface BindDeviceRequest {
  macAddress: string;
  /** Free-text, shown in WinBox/WebFig — used to make router-side entries self-explanatory during manual troubleshooting. */
  comment: string;
  /** Optional: pin the binding to a specific client IP in addition to MAC. Left unset by default since DHCP leases can change; MAC alone is sufficient for `type=bypassed`. */
  address?: string;
}

export interface BindDeviceResult {
  success: boolean;
  macAddress: string;
  routerEntryId?: string;
  error?: string;
  errorCode?: string;
}

export class HotspotDeviceBindingService {
  constructor(private mikrotikClient: MikroTikClient) {}

  /**
   * Ensure a bypassed ip-binding exists and is enabled for this MAC.
   * Idempotent: a second call for the same MAC is a no-op success, and a
   * call that finds a *disabled* binding (e.g. from a prior suspension)
   * re-enables it instead of creating a duplicate entry — RouterOS does not
   * enforce uniqueness on mac-address, so this service always checks first.
   */
  async bind(request: BindDeviceRequest): Promise<BindDeviceResult> {
    const mac = normalizeMac(request.macAddress);
    if (!mac) {
      return { success: false, macAddress: request.macAddress, error: "Invalid MAC address", errorCode: "INVALID_MAC" };
    }

    try {
      if (!this.mikrotikClient.isConnected()) {
        const connectResult = await this.mikrotikClient.connect();
        if (!connectResult.success) {
          return { success: false, macAddress: mac, error: connectResult.error, errorCode: connectResult.errorCode };
        }
      }

      const existing = await this.findBinding(mac);
      if (!existing.success) return { success: false, macAddress: mac, error: existing.error, errorCode: existing.errorCode };

      if (existing.data) {
        const entry = existing.data;
        const needsUpdate = entry.type !== "bypassed" || entry.disabled === "true" || entry.disabled === true;
        if (!needsUpdate) {
          return { success: true, macAddress: mac, routerEntryId: entry[".id"] as string };
        }
        const setResult = await this.mikrotikClient.run("/ip/hotspot/ip-binding", "set", {
          numbers: entry[".id"],
          type: "bypassed",
          disabled: "no",
          comment: request.comment,
          ...(request.address ? { address: request.address } : {}),
        });
        if (!setResult.success) return { success: false, macAddress: mac, error: setResult.error, errorCode: setResult.errorCode };
        return { success: true, macAddress: mac, routerEntryId: entry[".id"] as string };
      }

      const addResult = await this.mikrotikClient.run("/ip/hotspot/ip-binding", "add", {
        "mac-address": mac,
        type: "bypassed",
        disabled: "no",
        comment: request.comment,
        ...(request.address ? { address: request.address } : {}),
      });
      if (!addResult.success) return { success: false, macAddress: mac, error: addResult.error, errorCode: addResult.errorCode };

      // RouterOS `add` replies with the new entry's `.id` (via `ret`); re-look-up
      // defensively in case the client library surfaces it differently.
      const created = await this.findBinding(mac);
      const routerEntryId = created.success && created.data ? (created.data[".id"] as string) : undefined;
      return { success: true, macAddress: mac, routerEntryId };
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      return { success: false, macAddress: mac, error: err, errorCode: "BIND_EXCEPTION" };
    }
  }

  /**
   * Disable (not delete) a device's binding — used for suspension/overdue/
   * expiry, where the router state should be quickly reversible on resume
   * without recreating the entry. Missing entry is treated as success
   * (already effectively "not bound"), matching idempotent-suspend semantics
   * used elsewhere in this codebase (e.g. suspend on an already-suspended
   * hotspot user).
   */
  async disable(macAddress: string): Promise<BindDeviceResult> {
    const mac = normalizeMac(macAddress);
    if (!mac) return { success: false, macAddress, error: "Invalid MAC address", errorCode: "INVALID_MAC" };

    try {
      if (!this.mikrotikClient.isConnected()) {
        const connectResult = await this.mikrotikClient.connect();
        if (!connectResult.success) return { success: false, macAddress: mac, error: connectResult.error, errorCode: connectResult.errorCode };
      }
      const existing = await this.findBinding(mac);
      if (!existing.success) return { success: false, macAddress: mac, error: existing.error, errorCode: existing.errorCode };
      if (!existing.data) return { success: true, macAddress: mac }; // nothing to disable

      const result = await this.mikrotikClient.run("/ip/hotspot/ip-binding", "set", { numbers: existing.data[".id"], disabled: "yes" });
      if (!result.success) return { success: false, macAddress: mac, error: result.error, errorCode: result.errorCode };
      return { success: true, macAddress: mac, routerEntryId: existing.data[".id"] as string };
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      return { success: false, macAddress: mac, error: err, errorCode: "DISABLE_EXCEPTION" };
    }
  }

  /**
   * Permanently remove a device's binding — used on cancellation/
   * deprovisioning, or when a subscription's bound MAC changes (old MAC is
   * unbound before the new one is bound). Missing entry is success (already
   * removed), matching idempotent-deprovision semantics.
   */
  async remove(macAddress: string): Promise<BindDeviceResult> {
    const mac = normalizeMac(macAddress);
    if (!mac) return { success: false, macAddress, error: "Invalid MAC address", errorCode: "INVALID_MAC" };

    try {
      if (!this.mikrotikClient.isConnected()) {
        const connectResult = await this.mikrotikClient.connect();
        if (!connectResult.success) return { success: false, macAddress: mac, error: connectResult.error, errorCode: connectResult.errorCode };
      }
      const existing = await this.findBinding(mac);
      if (!existing.success) return { success: false, macAddress: mac, error: existing.error, errorCode: existing.errorCode };
      if (!existing.data) return { success: true, macAddress: mac };

      const result = await this.mikrotikClient.run("/ip/hotspot/ip-binding", "remove", { numbers: existing.data[".id"] });
      if (!result.success) return { success: false, macAddress: mac, error: result.error, errorCode: result.errorCode };
      return { success: true, macAddress: mac };
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      return { success: false, macAddress: mac, error: err, errorCode: "REMOVE_EXCEPTION" };
    }
  }

  /**
   * Force-drop any live Hotspot session already held by this MAC (e.g. it
   * was mid-session under the old profile/binding) so the new binding takes
   * effect immediately instead of waiting for the existing session to
   * expire naturally. Best-effort: failure here does not fail bind/disable.
   */
  async disconnectActiveSession(macAddress: string): Promise<void> {
    const mac = normalizeMac(macAddress);
    if (!mac) return;
    try {
      const result = await this.mikrotikClient.run("/ip/hotspot/active", "print", { "mac-address": mac });
      const sessions = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
      for (const s of sessions as Record<string, unknown>[]) {
        const id = s[".id"] as string | undefined;
        if (id) await this.mikrotikClient.run("/ip/hotspot/active", "remove", { numbers: id });
      }
    } catch {
      // best-effort; the binding change itself is what matters
    }
  }

  /** Looks up the current ip-binding row for a MAC, if any. */
  private async findBinding(mac: string): Promise<MikroTikResponse<Record<string, unknown> | null>> {
    const result = await this.mikrotikClient.run("/ip/hotspot/ip-binding", "print", { "mac-address": mac });
    if (!result.success) return result as MikroTikResponse<Record<string, unknown> | null>;
    const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
    return { success: true, data: (rows[0] as Record<string, unknown> | undefined) ?? null, timestamp: new Date().toISOString() };
  }
}

/** Accepts common MAC separator styles and normalizes to RouterOS's `AA:BB:CC:DD:EE:FF` uppercase form. Returns null for anything that isn't 6 hex octets. */
export function normalizeMac(input: string | undefined | null): string | null {
  if (!input) return null;
  const hex = input.trim().toUpperCase().replace(/[^0-9A-F]/g, "");
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g)!.join(":");
}
