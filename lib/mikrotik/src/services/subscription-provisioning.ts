import type { MikroTikResponse } from "../types";
import { MikroTikClient } from "../client";
import {
  PPPoEProvisioningService,
  type ProvisioningRequest,
  type ProvisioningResult,
  type DeprovisioningResult,
} from "./pppoe-provisioning";
import { HotspotProvisioningService } from "./hotspot-provisioning";

/**
 * Subscription → Router Provisioning Engine
 *
 * Orchestrates the entire lifecycle of subscriber provisioning:
 * - Receives subscription create/update/delete events
 * - Routes requests to appropriate MikroTik router
 * - Manages PPPoE account lifecycle (create, suspend, resume, delete)
 * - Handles multi-router deployments
 * - Tracks provisioning state for audit/troubleshooting
 *
 * NOT responsible for:
 * - Database persistence (caller's responsibility)
 * - Billing, payments, invoicing
 * - Customer management
 * - Session monitoring or traffic reporting
 */

export interface SubscriptionPlan {
  id: string;
  name: string;
  type: "PPPOE" | "HOTSPOT";
  speedUpKbps: number;
  speedDownKbps: number;
  durationDays: number;
}

export interface SubscriptionDetails {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  planId: string;
  plan: SubscriptionPlan;
  routerId: string;
  status: "PENDING_PROVISION" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
  startsAt: Date;
  expiresAt: Date;
}

export interface ProvisioningAuditEntry {
  subscriptionId: string;
  customerId: string;
  routerId: string;
  action: "PROVISION" | "DEPROVISION" | "SUSPEND" | "RESUME" | "CHANGE_PLAN" | "CHANGE_PASSWORD";
  status: "SUCCESS" | "FAILED" | "PARTIAL";
  username: string;
  errorCode?: string;
  errorMessage?: string;
  executedAt: string;
  duration_ms: number;
}

export interface SubscriptionProvisioningResult {
  success: boolean;
  subscriptionId: string;
  customerId: string;
  routerId: string;
  action: "PROVISION" | "DEPROVISION" | "SUSPEND" | "RESUME" | "CHANGE_PLAN" | "CHANGE_PASSWORD";
  status: "SUCCESS" | "FAILED" | "PARTIAL";
  username?: string;
  routerUsername?: string;
  error?: string;
  errorCode?: string;
  audit: ProvisioningAuditEntry;
}

/**
 * Manages subscription lifecycle and MikroTik provisioning coordination
 */
export class SubscriptionProvisioningService {
  private pppoeServices: Map<string, PPPoEProvisioningService> = new Map();
  private hotspotServices: Map<string, HotspotProvisioningService> = new Map();
  private auditLog: ProvisioningAuditEntry[] = [];

  constructor(
    private mikrotikClients: Map<string, MikroTikClient>,
    private logger?: { info: (msg: string) => void; error: (msg: string) => void }
  ) {
    // Initialize a PPPoE *and* a Hotspot provisioning service for each router
    // — which one gets used is decided per call by the plan's type.
    for (const [routerId, client] of mikrotikClients) {
      this.pppoeServices.set(routerId, new PPPoEProvisioningService(client));
      this.hotspotServices.set(routerId, new HotspotProvisioningService(client));
    }
  }

  /** Picks the PPPoE or Hotspot provisioning service for a router based on plan type. Both share the same provision()/deprovision()/suspend() shape. */
  private getService(routerId: string, planType: "PPPOE" | "HOTSPOT"): PPPoEProvisioningService | HotspotProvisioningService | undefined {
    return planType === "HOTSPOT" ? this.hotspotServices.get(routerId) : this.pppoeServices.get(routerId);
  }

  /**
   * Provision a new subscription on the assigned router
   *
   * Workflow:
   * 1. Validate subscription and plan
   * 2. Generate unique username (collision-safe)
   * 3. Generate secure password
   * 4. Route to appropriate MikroTik client
   * 5. Create PPPoE user via provisioning service
   * 6. Record audit trail
   * 7. Return provisioning details
   *
   * @param subscription Subscription details including plan and routing
   * @param generatedCredentials Pre-generated username and password (caller's responsibility)
   * @returns Provisioning result with success/failure details
   *
   * @example
   * const result = await subscriptionService.provision({
   *   id: "sub-123",
   *   customerId: "cust-456",
   *   customerName: "John Doe",
   *   customerPhone: "+254712345678",
   *   planId: "plan-10mbps",
   *   plan: {
   *     id: "plan-10mbps",
   *     name: "10 Mbps Plan",
   *     type: "PPPOE",
   *     speedUpKbps: 10000,
   *     speedDownKbps: 10000,
   *     durationDays: 30,
   *   },
   *   routerId: "router-nairobi-01",
   *   status: "PENDING_PROVISION",
   *   startsAt: new Date(),
   *   expiresAt: new Date(Date.now() + 30 * 86400000),
   * }, {
   *   username: "nairobi_cust456_a7k2j9x1",
   *   password: "GeneratedPassword123!@",
   * });
   */
  async provision(
    subscription: SubscriptionDetails,
    generatedCredentials: { username: string; password: string }
  ): Promise<SubscriptionProvisioningResult> {
    const startTime = Date.now();
    const executedAtISO = new Date().toISOString();

    try {
      // Validate inputs
      const validation = this.validateSubscription(subscription);
      if (!validation.valid) {
        const result: SubscriptionProvisioningResult = {
          success: false,
          subscriptionId: subscription.id,
          customerId: subscription.customerId,
          routerId: subscription.routerId,
          action: "PROVISION",
          status: "FAILED",
          error: validation.error,
          errorCode: "INVALID_SUBSCRIPTION",
          audit: {
            subscriptionId: subscription.id,
            customerId: subscription.customerId,
            routerId: subscription.routerId,
            action: "PROVISION",
            status: "FAILED",
            username: generatedCredentials.username,
            errorMessage: validation.error,
            errorCode: "INVALID_SUBSCRIPTION",
            executedAt: executedAtISO,
            duration_ms: Date.now() - startTime,
          },
        };

        this.auditLog.push(result.audit);
        return result;
      }

      // Get provisioning service for the router, routed by plan type (PPPoE vs Hotspot)
      const provisioningService = this.getService(subscription.routerId, subscription.plan.type);
      if (!provisioningService) {
        const error = `Router '${subscription.routerId}' not configured`;
        const result: SubscriptionProvisioningResult = {
          success: false,
          subscriptionId: subscription.id,
          customerId: subscription.customerId,
          routerId: subscription.routerId,
          action: "PROVISION",
          status: "FAILED",
          error,
          errorCode: "ROUTER_NOT_FOUND",
          audit: {
            subscriptionId: subscription.id,
            customerId: subscription.customerId,
            routerId: subscription.routerId,
            action: "PROVISION",
            status: "FAILED",
            username: generatedCredentials.username,
            errorMessage: error,
            errorCode: "ROUTER_NOT_FOUND",
            executedAt: executedAtISO,
            duration_ms: Date.now() - startTime,
          },
        };

        this.auditLog.push(result.audit);
        return result;
      }

      // Build provisioning request
      const provisioningRequest: ProvisioningRequest = {
        subscriptionId: subscription.id,
        customerId: subscription.customerId,
        routerId: subscription.routerId,
        username: generatedCredentials.username,
        password: generatedCredentials.password,
        profileName: this.getProfileName(subscription.plan),
        speedUpKbps: subscription.plan.speedUpKbps,
        speedDownKbps: subscription.plan.speedDownKbps,
      };

      this.log(
        `Provisioning subscription ${subscription.id} for customer ${subscription.customerId} on router ${subscription.routerId}`
      );

      // Provision PPPoE user
      const provisioningResult = await provisioningService.provision(
        provisioningRequest
      );

      const success = provisioningResult.success;

      const result: SubscriptionProvisioningResult = {
        success,
        subscriptionId: subscription.id,
        customerId: subscription.customerId,
        routerId: subscription.routerId,
        action: "PROVISION",
        status: success ? "SUCCESS" : "FAILED",
        username: generatedCredentials.username,
        routerUsername: provisioningResult.routerUsername,
        error: provisioningResult.error,
        errorCode: provisioningResult.errorCode,
        audit: {
          subscriptionId: subscription.id,
          customerId: subscription.customerId,
          routerId: subscription.routerId,
          action: "PROVISION",
          status: success ? "SUCCESS" : "FAILED",
          username: generatedCredentials.username,
          errorMessage: provisioningResult.error,
          errorCode: provisioningResult.errorCode,
          executedAt: executedAtISO,
          duration_ms: Date.now() - startTime,
        },
      };

      this.auditLog.push(result.audit);

      if (success) {
        this.log(
          `Successfully provisioned subscription ${subscription.id}: user ${generatedCredentials.username}`
        );
      } else {
        this.logError(
          `Failed to provision subscription ${subscription.id}: ${provisioningResult.error}`
        );
      }

      return result;
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      const result: SubscriptionProvisioningResult = {
        success: false,
        subscriptionId: subscription.id,
        customerId: subscription.customerId,
        routerId: subscription.routerId,
        action: "PROVISION",
        status: "FAILED",
        username: generatedCredentials.username,
        error: err,
        errorCode: "PROVISION_EXCEPTION",
        audit: {
          subscriptionId: subscription.id,
          customerId: subscription.customerId,
          routerId: subscription.routerId,
          action: "PROVISION",
          status: "FAILED",
          username: generatedCredentials.username,
          errorMessage: err,
          errorCode: "PROVISION_EXCEPTION",
          executedAt: executedAtISO,
          duration_ms: Date.now() - startTime,
        },
      };

      this.auditLog.push(result.audit);
      this.logError(
        `Exception during provisioning of subscription ${subscription.id}: ${err}`
      );

      return result;
    }
  }

  /**
   * Deprovision (remove) a subscription from the router
   *
   * Workflow:
   * 1. Find the provisioning service for the assigned router
   * 2. Remove PPPoE user from router
   * 3. Clean up bandwidth limits
   * 4. Record audit trail
   * 5. Return result
   *
   * @param subscriptionId Subscription ID
   * @param customerId Customer ID (for audit trail)
   * @param routerId Router ID where subscription is provisioned
   * @param username PPPoE username on the router
   * @returns Deprovisioning result
   *
   * @example
   * const result = await subscriptionService.deprovision(
   *   "sub-123",
   *   "cust-456",
   *   "router-nairobi-01",
   *   "nairobi_cust456_a7k2j9x1"
   * );
   */
  async deprovision(
    subscriptionId: string,
    customerId: string,
    routerId: string,
    username: string,
    planType: "PPPOE" | "HOTSPOT" = "PPPOE"
  ): Promise<SubscriptionProvisioningResult> {
    const startTime = Date.now();
    const executedAtISO = new Date().toISOString();

    try {
      const provisioningService = this.getService(routerId, planType);
      if (!provisioningService) {
        const error = `Router '${routerId}' not configured`;
        const result: SubscriptionProvisioningResult = {
          success: false,
          subscriptionId,
          customerId,
          routerId,
          action: "DEPROVISION",
          status: "FAILED",
          username,
          error,
          errorCode: "ROUTER_NOT_FOUND",
          audit: {
            subscriptionId,
            customerId,
            routerId,
            action: "DEPROVISION",
            status: "FAILED",
            username,
            errorMessage: error,
            errorCode: "ROUTER_NOT_FOUND",
            executedAt: executedAtISO,
            duration_ms: Date.now() - startTime,
          },
        };

        this.auditLog.push(result.audit);
        return result;
      }

      this.log(
        `Deprovisioning subscription ${subscriptionId} (user: ${username}) from router ${routerId}`
      );

      const deprovisioningResult = await provisioningService.deprovision(
        subscriptionId,
        routerId,
        username
      );

      const success = deprovisioningResult.success;

      const result: SubscriptionProvisioningResult = {
        success,
        subscriptionId,
        customerId,
        routerId,
        action: "DEPROVISION",
        status: success ? "SUCCESS" : "FAILED",
        username,
        error: deprovisioningResult.error,
        errorCode: deprovisioningResult.errorCode,
        audit: {
          subscriptionId,
          customerId,
          routerId,
          action: "DEPROVISION",
          status: success ? "SUCCESS" : "FAILED",
          username,
          errorMessage: deprovisioningResult.error,
          errorCode: deprovisioningResult.errorCode,
          executedAt: executedAtISO,
          duration_ms: Date.now() - startTime,
        },
      };

      this.auditLog.push(result.audit);

      if (success) {
        this.log(`Successfully deprovisioned subscription ${subscriptionId}`);
      } else {
        this.logError(
          `Failed to deprovision subscription ${subscriptionId}: ${deprovisioningResult.error}`
        );
      }

      return result;
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      const result: SubscriptionProvisioningResult = {
        success: false,
        subscriptionId,
        customerId,
        routerId,
        action: "DEPROVISION",
        status: "FAILED",
        username,
        error: err,
        errorCode: "DEPROVISION_EXCEPTION",
        audit: {
          subscriptionId,
          customerId,
          routerId,
          action: "DEPROVISION",
          status: "FAILED",
          username,
          errorMessage: err,
          errorCode: "DEPROVISION_EXCEPTION",
          executedAt: executedAtISO,
          duration_ms: Date.now() - startTime,
        },
      };

      this.auditLog.push(result.audit);
      this.logError(
        `Exception during deprovisioning of subscription ${subscriptionId}: ${err}`
      );

      return result;
    }
  }

  /**
   * Suspend a subscription (disable PPPoE user, prevent new connections)
   * User configuration remains on router for quick resume
   *
   * Use case: Customer payment late, suspend service but auto-resume after payment
   *
   * @param subscriptionId Subscription ID
   * @param customerId Customer ID (for audit)
   * @param routerId Router where user is provisioned
   * @param username PPPoE username
   * @returns Suspension result
   */
  async suspend(
    subscriptionId: string,
    customerId: string,
    routerId: string,
    username: string,
    planType: "PPPOE" | "HOTSPOT" = "PPPOE"
  ): Promise<SubscriptionProvisioningResult> {
    const startTime = Date.now();
    const executedAtISO = new Date().toISOString();

    try {
      const provisioningService = this.getService(routerId, planType);
      if (!provisioningService) {
        const error = `Router '${routerId}' not configured`;
        const result: SubscriptionProvisioningResult = {
          success: false,
          subscriptionId,
          customerId,
          routerId,
          action: "SUSPEND",
          status: "FAILED",
          username,
          error,
          errorCode: "ROUTER_NOT_FOUND",
          audit: {
            subscriptionId,
            customerId,
            routerId,
            action: "SUSPEND",
            status: "FAILED",
            username,
            errorMessage: error,
            errorCode: "ROUTER_NOT_FOUND",
            executedAt: executedAtISO,
            duration_ms: Date.now() - startTime,
          },
        };

        this.auditLog.push(result.audit);
        return result;
      }

      this.log(
        `Suspending subscription ${subscriptionId} (user: ${username}) on router ${routerId}`
      );

      const suspendResult = await provisioningService.suspend(username);

      const success = suspendResult.success;

      const result: SubscriptionProvisioningResult = {
        success,
        subscriptionId,
        customerId,
        routerId,
        action: "SUSPEND",
        status: success ? "SUCCESS" : "FAILED",
        username,
        error: suspendResult.error,
        errorCode: suspendResult.errorCode,
        audit: {
          subscriptionId,
          customerId,
          routerId,
          action: "SUSPEND",
          status: success ? "SUCCESS" : "FAILED",
          username,
          errorMessage: suspendResult.error,
          errorCode: suspendResult.errorCode,
          executedAt: executedAtISO,
          duration_ms: Date.now() - startTime,
        },
      };

      this.auditLog.push(result.audit);

      if (success) {
        this.log(`Successfully suspended subscription ${subscriptionId}`);
      } else {
        this.logError(
          `Failed to suspend subscription ${subscriptionId}: ${suspendResult.error}`
        );
      }

      return result;
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      const result: SubscriptionProvisioningResult = {
        success: false,
        subscriptionId,
        customerId,
        routerId,
        action: "SUSPEND",
        status: "FAILED",
        username,
        error: err,
        errorCode: "SUSPEND_EXCEPTION",
        audit: {
          subscriptionId,
          customerId,
          routerId,
          action: "SUSPEND",
          status: "FAILED",
          username,
          errorMessage: err,
          errorCode: "SUSPEND_EXCEPTION",
          executedAt: executedAtISO,
          duration_ms: Date.now() - startTime,
        },
      };

      this.auditLog.push(result.audit);
      this.logError(
        `Exception during suspension of subscription ${subscriptionId}: ${err}`
      );

      return result;
    }
  }

  /**
   * Resume a suspended subscription (re-enable PPPoE user)
   * User can immediately reconnect with existing credentials
   *
   * Use case: Payment received, resume service
   *
   * @param subscriptionId Subscription ID
   * @param customerId Customer ID (for audit)
   * @param routerId Router where user is provisioned
   * @param username PPPoE username
   * @returns Resume result
   */
  async resume(
    subscriptionId: string,
    customerId: string,
    routerId: string,
    username: string,
    planType: "PPPOE" | "HOTSPOT" = "PPPOE"
  ): Promise<SubscriptionProvisioningResult> {
    const startTime = Date.now();
    const executedAtISO = new Date().toISOString();

    try {
      const provisioningService = this.getService(routerId, planType);
      if (!provisioningService) {
        const error = `Router '${routerId}' not configured`;
        const result: SubscriptionProvisioningResult = {
          success: false,
          subscriptionId,
          customerId,
          routerId,
          action: "RESUME",
          status: "FAILED",
          username,
          error,
          errorCode: "ROUTER_NOT_FOUND",
          audit: {
            subscriptionId,
            customerId,
            routerId,
            action: "RESUME",
            status: "FAILED",
            username,
            errorMessage: error,
            errorCode: "ROUTER_NOT_FOUND",
            executedAt: executedAtISO,
            duration_ms: Date.now() - startTime,
          },
        };

        this.auditLog.push(result.audit);
        return result;
      }

      this.log(
        `Resuming subscription ${subscriptionId} (user: ${username}) on router ${routerId}`
      );

      const resumeResult = await provisioningService.resume(username);

      const success = resumeResult.success;

      const result: SubscriptionProvisioningResult = {
        success,
        subscriptionId,
        customerId,
        routerId,
        action: "RESUME",
        status: success ? "SUCCESS" : "FAILED",
        username,
        error: resumeResult.error,
        errorCode: resumeResult.errorCode,
        audit: {
          subscriptionId,
          customerId,
          routerId,
          action: "RESUME",
          status: success ? "SUCCESS" : "FAILED",
          username,
          errorMessage: resumeResult.error,
          errorCode: resumeResult.errorCode,
          executedAt: executedAtISO,
          duration_ms: Date.now() - startTime,
        },
      };

      this.auditLog.push(result.audit);

      if (success) {
        this.log(`Successfully resumed subscription ${subscriptionId}`);
      } else {
        this.logError(
          `Failed to resume subscription ${subscriptionId}: ${resumeResult.error}`
        );
      }

      return result;
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      const result: SubscriptionProvisioningResult = {
        success: false,
        subscriptionId,
        customerId,
        routerId,
        action: "RESUME",
        status: "FAILED",
        username,
        error: err,
        errorCode: "RESUME_EXCEPTION",
        audit: {
          subscriptionId,
          customerId,
          routerId,
          action: "RESUME",
          status: "FAILED",
          username,
          errorMessage: err,
          errorCode: "RESUME_EXCEPTION",
          executedAt: executedAtISO,
          duration_ms: Date.now() - startTime,
        },
      };

      this.auditLog.push(result.audit);
      this.logError(
        `Exception during resumption of subscription ${subscriptionId}: ${err}`
      );

      return result;
    }
  }

  /**
   * Get audit trail for a subscription
   * Useful for troubleshooting and compliance
   *
   * @param subscriptionId Subscription ID to filter by (optional)
   * @returns Array of audit entries
   */
  getAuditTrail(subscriptionId?: string): ProvisioningAuditEntry[] {
    if (!subscriptionId) {
      return this.auditLog;
    }

    return this.auditLog.filter((entry) => entry.subscriptionId === subscriptionId);
  }

  /**
   * Clear audit trail (be careful with this!)
   * Usually called after archiving audit data to persistent storage
   */
  clearAuditTrail(): void {
    this.auditLog = [];
  }

  /**
   * Private: Validate subscription before provisioning
   */
  private validateSubscription(
    subscription: SubscriptionDetails
  ): { valid: boolean; error?: string } {
    if (!subscription.id) {
      return { valid: false, error: "Missing subscription ID" };
    }

    if (!subscription.customerId) {
      return { valid: false, error: "Missing customer ID" };
    }

    if (!subscription.routerId) {
      return { valid: false, error: "Missing router ID" };
    }

    if (!subscription.plan) {
      return { valid: false, error: "Missing subscription plan" };
    }

    if (subscription.plan.type !== "PPPOE" && subscription.plan.type !== "HOTSPOT") {
      return {
        valid: false,
        error: `Unsupported plan type: ${subscription.plan.type}`,
      };
    }

    if (subscription.plan.speedUpKbps <= 0 || subscription.plan.speedDownKbps <= 0) {
      return {
        valid: false,
        error: "Plan speeds must be greater than 0",
      };
    }

    if (subscription.expiresAt <= subscription.startsAt) {
      return {
        valid: false,
        error: "Subscription expiry must be after start time",
      };
    }

    return { valid: true };
  }

  /**
   * Public: Generate PPPoE/Hotspot profile name from plan (shared so
   * callers computing a *target* profile for a plan change use the exact
   * same naming convention as provisioning does).
   */
  getProfileName(plan: SubscriptionPlan): string {
    // Convention: pppoe-{speedUpMbps}mbps-{speedDownMbps}mbps
    const upMbps = Math.round(plan.speedUpKbps / 1000);
    const downMbps = Math.round(plan.speedDownKbps / 1000);
    return `pppoe-${upMbps}mbps-${downMbps}mbps`;
  }

  /**
   * Moves a provisioned subscriber onto a new plan's profile — upgrade,
   * downgrade, or any other plan change that keeps the same router. Creates
   * the target profile if it doesn't exist yet; does not touch the
   * account's password or its enabled/disabled state.
   */
  async changePlan(
    subscriptionId: string,
    customerId: string,
    routerId: string,
    username: string,
    newPlan: SubscriptionPlan,
    planType: "PPPOE" | "HOTSPOT" = "PPPOE"
  ): Promise<SubscriptionProvisioningResult> {
    const startTime = Date.now();
    const executedAtISO = new Date().toISOString();
    const provisioningService = this.getService(routerId, planType);

    if (!provisioningService) {
      return this.buildResult(subscriptionId, customerId, routerId, username, "CHANGE_PLAN", false, startTime, executedAtISO, `Router '${routerId}' not configured`, "ROUTER_NOT_FOUND");
    }

    try {
      const profile = { name: this.getProfileName(newPlan), speedUpKbps: newPlan.speedUpKbps, speedDownKbps: newPlan.speedDownKbps };
      const updateResult = await provisioningService.updateProfile(username, profile);
      if (updateResult.success) this.log(`Moved subscription ${subscriptionId} (user: ${username}) to profile ${profile.name}`);
      else this.logError(`Failed to change plan for subscription ${subscriptionId}: ${updateResult.error}`);
      return this.buildResult(subscriptionId, customerId, routerId, username, "CHANGE_PLAN", updateResult.success, startTime, executedAtISO, updateResult.error, updateResult.errorCode);
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      this.logError(`Exception changing plan for subscription ${subscriptionId}: ${err}`);
      return this.buildResult(subscriptionId, customerId, routerId, username, "CHANGE_PLAN", false, startTime, executedAtISO, err, "CHANGE_PLAN_EXCEPTION");
    }
  }

  /** Sets a new router-side password for an already-provisioned subscriber (admin-triggered password reset). */
  async resetPassword(
    subscriptionId: string,
    customerId: string,
    routerId: string,
    username: string,
    newPassword: string,
    planType: "PPPOE" | "HOTSPOT" = "PPPOE"
  ): Promise<SubscriptionProvisioningResult> {
    const startTime = Date.now();
    const executedAtISO = new Date().toISOString();
    const provisioningService = this.getService(routerId, planType);

    if (!provisioningService) {
      return this.buildResult(subscriptionId, customerId, routerId, username, "CHANGE_PASSWORD", false, startTime, executedAtISO, `Router '${routerId}' not configured`, "ROUTER_NOT_FOUND");
    }

    try {
      const result = await provisioningService.setPassword(username, newPassword);
      if (result.success) this.log(`Reset router password for subscription ${subscriptionId} (user: ${username})`);
      else this.logError(`Failed to reset password for subscription ${subscriptionId}: ${result.error}`);
      return this.buildResult(subscriptionId, customerId, routerId, username, "CHANGE_PASSWORD", result.success, startTime, executedAtISO, result.error, result.errorCode);
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      this.logError(`Exception resetting password for subscription ${subscriptionId}: ${err}`);
      return this.buildResult(subscriptionId, customerId, routerId, username, "CHANGE_PASSWORD", false, startTime, executedAtISO, err, "RESET_PASSWORD_EXCEPTION");
    }
  }

  /** Shared result/audit-entry builder for the simpler (single-call) actions, so changePlan/resetPassword don't each duplicate the ~30-line result-shape literal used by suspend/resume above. */
  private buildResult(
    subscriptionId: string,
    customerId: string,
    routerId: string,
    username: string,
    action: ProvisioningAuditEntry["action"],
    success: boolean,
    startTime: number,
    executedAtISO: string,
    error?: string,
    errorCode?: string
  ): SubscriptionProvisioningResult {
    const audit: ProvisioningAuditEntry = {
      subscriptionId, customerId, routerId, action,
      status: success ? "SUCCESS" : "FAILED",
      username, errorMessage: error, errorCode,
      executedAt: executedAtISO, duration_ms: Date.now() - startTime,
    };
    this.auditLog.push(audit);
    return { success, subscriptionId, customerId, routerId, action, status: success ? "SUCCESS" : "FAILED", username, error, errorCode, audit };
  }

  /**
   * Private: Log info messages
   */
  private log(message: string): void {
    if (this.logger?.info) {
      this.logger.info(message);
    } else {
      console.log(`[SubscriptionProvisioning] ${message}`);
    }
  }

  /**
   * Private: Log error messages
   */
  private logError(message: string): void {
    if (this.logger?.error) {
      this.logger.error(message);
    } else {
      console.error(`[SubscriptionProvisioning] ERROR: ${message}`);
    }
  }
}
