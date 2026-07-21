import type { MikroTikResponse } from "../types";
import { MikroTikClient } from "../client";
import type { ProvisioningRequest, ProvisioningResult, DeprovisioningResult, ProfileConfig } from "./pppoe-provisioning";

/**
 * Hotspot Provisioning Engine for PulseNet Billing
 *
 * The counterpart to PPPoEProvisioningService for HOTSPOT-type plans. Follows
 * the exact same request/result shapes and step order (collision check ->
 * ensure profile -> create user) so callers (SubscriptionProvisioningService)
 * can treat both services interchangeably. Unlike PPPoE, RouterOS applies the
 * speed limit directly on the Hotspot user profile's `rate-limit`, so there is
 * no separate `/queue/simple` step.
 *
 * Responsibilities:
 * - Automatically create/remove RouterOS Hotspot user accounts
 * - Manage Hotspot user profiles linked to billing plans
 * - Apply bandwidth limits via the Hotspot profile's rate-limit
 *
 * NOT responsible for:
 * - Database persistence (that's the service layer's job)
 * - Billing, invoicing, or payment processing
 * - Session monitoring (see services/hotspot-sessions.ts for that)
 */
export class HotspotProvisioningService {
  constructor(private mikrotikClient: MikroTikClient) {}

  /** Provision a new Hotspot user account on the router. Mirrors PPPoEProvisioningService.provision(). */
  async provision(request: ProvisioningRequest): Promise<ProvisioningResult> {
    const startTime = new Date().toISOString();

    try {
      if (!this.mikrotikClient.isConnected()) {
        const connectResult = await this.mikrotikClient.connect();
        if (!connectResult.success) {
          return { success: false, subscriptionId: request.subscriptionId, routerId: request.routerId, username: request.username, error: connectResult.error, errorCode: connectResult.errorCode, createdAt: startTime };
        }
      }

      const userExists = await this.checkUserExists(request.username);
      if (userExists.exists) {
        return { success: false, subscriptionId: request.subscriptionId, routerId: request.routerId, username: request.username, error: `Username '${request.username}' already exists on router`, errorCode: "USERNAME_COLLISION", createdAt: startTime };
      }

      const profileCheck = await this.ensureProfileExists({ name: request.profileName, speedUpKbps: request.speedUpKbps, speedDownKbps: request.speedDownKbps });
      if (!profileCheck.success) {
        return { success: false, subscriptionId: request.subscriptionId, routerId: request.routerId, username: request.username, error: `Failed to ensure profile '${request.profileName}': ${profileCheck.error}`, errorCode: profileCheck.errorCode, createdAt: startTime };
      }

      const createResult = await this.createHotspotUser(request.username, request.password, request.profileName);
      if (!createResult.success) {
        return { success: false, subscriptionId: request.subscriptionId, routerId: request.routerId, username: request.username, error: createResult.error, errorCode: createResult.errorCode, createdAt: startTime };
      }

      return { success: true, subscriptionId: request.subscriptionId, routerId: request.routerId, username: request.username, routerUsername: request.username, createdAt: startTime };
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      return { success: false, subscriptionId: request.subscriptionId, routerId: request.routerId, username: request.username, error: err, errorCode: "PROVISIONING_EXCEPTION", createdAt: startTime };
    }
  }

  /** Deprovision (remove) a Hotspot user account from the router. Mirrors PPPoEProvisioningService.deprovision(). */
  async deprovision(subscriptionId: string, routerId: string, username: string): Promise<DeprovisioningResult> {
    const startTime = new Date().toISOString();
    try {
      if (!this.mikrotikClient.isConnected()) {
        const connectResult = await this.mikrotikClient.connect();
        if (!connectResult.success) {
          return { success: false, subscriptionId, routerId, username, error: connectResult.error, errorCode: connectResult.errorCode, removedAt: startTime };
        }
      }

      const userExists = await this.checkUserExists(username);
      if (!userExists.exists) {
        return { success: false, subscriptionId, routerId, username, error: `User '${username}' not found on router`, errorCode: "USER_NOT_FOUND", removedAt: startTime };
      }

      const removeResult = await this.removeHotspotUser(username);
      if (!removeResult.success) {
        return { success: false, subscriptionId, routerId, username, error: removeResult.error, errorCode: removeResult.errorCode, removedAt: startTime };
      }

      return { success: true, subscriptionId, routerId, username, removedAt: startTime };
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      return { success: false, subscriptionId, routerId, username, error: err, errorCode: "DEPROVISIONING_EXCEPTION", removedAt: startTime };
    }
  }

  /** Suspend a Hotspot user (disable account but keep configuration). */
  async suspend(username: string): Promise<MikroTikResponse<{ disabled: true }>> {
    const idResult = await this.findUserId(username);
    if (!idResult.success) return idResult as MikroTikResponse<{ disabled: true }>;
    const result = await this.mikrotikClient.run("/ip/hotspot/user", "set", { numbers: idResult.data!, disabled: "yes" });
    if (!result.success) return result as MikroTikResponse<{ disabled: true }>;
    return { success: true, data: { disabled: true }, timestamp: new Date().toISOString() };
  }

  /** Resume a previously suspended Hotspot user. */
  async resume(username: string): Promise<MikroTikResponse<{ disabled: false }>> {
    const idResult = await this.findUserId(username);
    if (!idResult.success) return idResult as MikroTikResponse<{ disabled: false }>;
    const result = await this.mikrotikClient.run("/ip/hotspot/user", "set", { numbers: idResult.data!, disabled: "no" });
    if (!result.success) return result as MikroTikResponse<{ disabled: false }>;
    return { success: true, data: { disabled: false }, timestamp: new Date().toISOString() };
  }

  /** Moves an existing Hotspot user onto a different profile (plan upgrade/downgrade), creating the target profile first if needed. */
  async updateProfile(username: string, profile: ProfileConfig): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    if (!this.mikrotikClient.isConnected()) {
      const connectResult = await this.mikrotikClient.connect();
      if (!connectResult.success) return { success: false, error: connectResult.error, errorCode: connectResult.errorCode };
    }
    const profileCheck = await this.ensureProfileExists(profile);
    if (!profileCheck.success) return profileCheck;
    const idResult = await this.findUserId(username);
    if (!idResult.success) return { success: false, error: idResult.error, errorCode: idResult.errorCode };
    const result = await this.mikrotikClient.run("/ip/hotspot/user", "set", { numbers: idResult.data!, profile: profile.name });
    if (!result.success) return { success: false, error: result.error, errorCode: result.errorCode };
    return { success: true };
  }

  /** Sets a new password for an existing Hotspot user (password reset). */
  async setPassword(username: string, newPassword: string): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    if (!this.mikrotikClient.isConnected()) {
      const connectResult = await this.mikrotikClient.connect();
      if (!connectResult.success) return { success: false, error: connectResult.error, errorCode: connectResult.errorCode };
    }
    const idResult = await this.findUserId(username);
    if (!idResult.success) return { success: false, error: idResult.error, errorCode: idResult.errorCode };
    const result = await this.mikrotikClient.run("/ip/hotspot/user", "set", { numbers: idResult.data!, password: newPassword });
    if (!result.success) return { success: false, error: result.error, errorCode: result.errorCode };
    return { success: true };
  }

  /** Looks up a Hotspot user's internal `.id` by name — RouterOS's `set`/`remove` commands require `numbers=<.id>`, not `name=`. */
  private async findUserId(username: string): Promise<MikroTikResponse<string>> {
    const result = await this.mikrotikClient.run("/ip/hotspot/user", "print", { name: username });
    if (!result.success) return result as MikroTikResponse<string>;
    const users = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
    if (users.length === 0) return { success: false, error: `User '${username}' not found`, errorCode: "USER_NOT_FOUND", timestamp: new Date().toISOString() };
    return { success: true, data: (users[0] as Record<string, unknown>)[".id"] as string, timestamp: new Date().toISOString() };
  }

  private async checkUserExists(username: string): Promise<{ exists: boolean; userDetails?: Record<string, unknown> }> {
    const result = await this.mikrotikClient.run("/ip/hotspot/user", "print", { name: username });
    if (!result.success) return { exists: false };
    const users = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
    if (users.length === 0) return { exists: false };
    return { exists: true, userDetails: users[0] as Record<string, unknown> };
  }

  private async ensureProfileExists(profile: ProfileConfig): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    const checkResult = await this.mikrotikClient.run("/ip/hotspot/user/profile", "print", { name: profile.name });
    if (checkResult.success) {
      const profiles = Array.isArray(checkResult.data) ? checkResult.data : checkResult.data ? [checkResult.data] : [];
      if (profiles.length > 0) return { success: true };
    }

    const createResult = await this.mikrotikClient.run("/ip/hotspot/user/profile", "add", {
      name: profile.name,
      "rate-limit": `${profile.speedUpKbps}k/${profile.speedDownKbps}k`,
      comment: profile.comment || "Auto-created for PulseNet Billing",
    });
    if (!createResult.success) return { success: false, error: createResult.error, errorCode: createResult.errorCode };
    return { success: true };
  }

  private async createHotspotUser(username: string, password: string, profile: string): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    const result = await this.mikrotikClient.run("/ip/hotspot/user", "add", { name: username, password, profile, disabled: "no" });
    if (!result.success) return { success: false, error: result.error, errorCode: result.errorCode };
    return { success: true };
  }

  private async removeHotspotUser(username: string): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    const findResult = await this.mikrotikClient.run("/ip/hotspot/user", "print", { name: username });
    if (!findResult.success) return { success: false, error: findResult.error, errorCode: findResult.errorCode };
    const users = Array.isArray(findResult.data) ? findResult.data : findResult.data ? [findResult.data] : [];
    if (users.length === 0) return { success: false, error: `User '${username}' not found`, errorCode: "USER_NOT_FOUND" };
    const userId = (users[0] as Record<string, unknown>)[".id"];
    const removeResult = await this.mikrotikClient.run("/ip/hotspot/user", "remove", { numbers: userId });
    if (!removeResult.success) return { success: false, error: removeResult.error, errorCode: removeResult.errorCode };
    return { success: true };
  }
}
