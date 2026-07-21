import type { MikroTikResponse } from "../types";
import { MikroTikClient } from "../client";

/**
 * PPPoE Provisioning Engine for PulseNet Billing
 *
 * Responsibilities:
 * - Automatically create/remove PPPoE user accounts on MikroTik routers
 * - Manage PPPoE user profiles linked to billing plans
 * - Apply bandwidth limits to users
 * - Track provisioning state and handle errors
 *
 * NOT responsible for:
 * - Database persistence (that's the service layer's job)
 * - Billing, invoicing, or payment processing
 * - Customer account management
 * - Session monitoring (that's a background job)
 */

export interface ProvisioningRequest {
  subscriptionId: string;
  customerId: string;
  routerId: string;
  username: string;
  password: string;
  profileName: string;
  speedUpKbps: number;
  speedDownKbps: number;
}

export interface ProvisioningResult {
  success: boolean;
  subscriptionId: string;
  routerId: string;
  username: string;
  routerUsername?: string; // May differ from requested username if collision
  error?: string;
  errorCode?: string;
  createdAt: string;
}

export interface DeprovisioningResult {
  success: boolean;
  subscriptionId: string;
  routerId: string;
  username: string;
  error?: string;
  errorCode?: string;
  removedAt: string;
}

export interface ProfileConfig {
  name: string;
  speedUpKbps: number;
  speedDownKbps: number;
  sessionTimeout?: number; // seconds, optional
  maxConnections?: number; // max concurrent sessions
  comment?: string;
}

/**
 * PPPoE Provisioning Service
 * Handles all PPPoE user lifecycle operations
 */
export class PPPoEProvisioningService {
  constructor(private mikrotikClient: MikroTikClient) {}

  /**
   * Provision a new PPPoE user account on the router
   *
   * Flow:
   * 1. Verify router connection
   * 2. Check if username already exists (collision detection)
   * 3. Ensure profile exists on router
   * 4. Create PPPoE user
   * 5. Apply bandwidth limit
   *
   * @param request Provisioning request with user details
   * @returns Provisioning result with success/failure details
   *
   * @example
   * const result = await pppoeService.provision({
   *   subscriptionId: "sub-123",
   *   customerId: "cust-456",
   *   routerId: "router-1",
   *   username: "user_cust456_sub123",
   *   password: "GeneratedPassword123!",
   *   profileName: "pppoe-10mbps",
   *   speedUpKbps: 10000,
   *   speedDownKbps: 10000,
   * });
   */
  async provision(request: ProvisioningRequest): Promise<ProvisioningResult> {
    const startTime = new Date().toISOString();

    try {
      // Step 1: Verify connection
      if (!this.mikrotikClient.isConnected()) {
        const connectResult = await this.mikrotikClient.connect();
        if (!connectResult.success) {
          return {
            success: false,
            subscriptionId: request.subscriptionId,
            routerId: request.routerId,
            username: request.username,
            error: connectResult.error,
            errorCode: connectResult.errorCode,
            createdAt: startTime,
          };
        }
      }

      // Step 2: Check username collision
      const userExists = await this.checkUserExists(request.username);
      if (userExists.exists) {
        return {
          success: false,
          subscriptionId: request.subscriptionId,
          routerId: request.routerId,
          username: request.username,
          error: `Username '${request.username}' already exists on router`,
          errorCode: "USERNAME_COLLISION",
          createdAt: startTime,
        };
      }

      // Step 3: Verify/create profile
      const profileCheck = await this.ensureProfileExists({
        name: request.profileName,
        speedUpKbps: request.speedUpKbps,
        speedDownKbps: request.speedDownKbps,
      });

      if (!profileCheck.success) {
        return {
          success: false,
          subscriptionId: request.subscriptionId,
          routerId: request.routerId,
          username: request.username,
          error: `Failed to ensure profile '${request.profileName}': ${profileCheck.error}`,
          errorCode: profileCheck.errorCode,
          createdAt: startTime,
        };
      }

      // Step 4: Create PPPoE user
      const createResult = await this.createPPPoEUser(
        request.username,
        request.password,
        request.profileName
      );

      if (!createResult.success) {
        return {
          success: false,
          subscriptionId: request.subscriptionId,
          routerId: request.routerId,
          username: request.username,
          error: createResult.error,
          errorCode: createResult.errorCode,
          createdAt: startTime,
        };
      }

      // Step 5: Apply bandwidth limit
      const limitResult = await this.setBandwidthLimit(
        request.username,
        request.speedUpKbps,
        request.speedDownKbps
      );

      if (!limitResult.success) {
        // Bandwidth limit failure is non-critical - user is created
        // Log this but don't fail the provisioning
        console.warn(
          `Warning: Failed to set bandwidth limit for ${request.username}: ${limitResult.error}`
        );
      }

      return {
        success: true,
        subscriptionId: request.subscriptionId,
        routerId: request.routerId,
        username: request.username,
        routerUsername: request.username,
        createdAt: startTime,
      };
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        subscriptionId: request.subscriptionId,
        routerId: request.routerId,
        username: request.username,
        error: err,
        errorCode: "PROVISIONING_EXCEPTION",
        createdAt: startTime,
      };
    }
  }

  /**
   * Deprovision (remove) a PPPoE user account from the router
   *
   * Flow:
   * 1. Verify router connection
   * 2. Find user on router
   * 3. Remove bandwidth limit queue (if exists)
   * 4. Remove PPPoE user
   *
   * @param subscriptionId Subscription ID for tracking
   * @param routerId Router ID for logging
   * @param username PPPoE username to remove
   * @returns Deprovisioning result
   *
   * @example
   * const result = await pppoeService.deprovision(
   *   "sub-123",
   *   "router-1",
   *   "user_cust456_sub123"
   * );
   */
  async deprovision(
    subscriptionId: string,
    routerId: string,
    username: string
  ): Promise<DeprovisioningResult> {
    const startTime = new Date().toISOString();

    try {
      if (!this.mikrotikClient.isConnected()) {
        const connectResult = await this.mikrotikClient.connect();
        if (!connectResult.success) {
          return {
            success: false,
            subscriptionId,
            routerId,
            username,
            error: connectResult.error,
            errorCode: connectResult.errorCode,
            removedAt: startTime,
          };
        }
      }

      // Find the user
      const userExists = await this.checkUserExists(username);
      if (!userExists.exists) {
        return {
          success: false,
          subscriptionId,
          routerId,
          username,
          error: `User '${username}' not found on router`,
          errorCode: "USER_NOT_FOUND",
          removedAt: startTime,
        };
      }

      // Remove bandwidth limit queue (best effort)
      await this.removeBandwidthLimit(username).catch(() => {
        // Silently ignore if queue doesn't exist
      });

      // Remove PPPoE user
      const removeResult = await this.removePPPoEUser(username);

      if (!removeResult.success) {
        return {
          success: false,
          subscriptionId,
          routerId,
          username,
          error: removeResult.error,
          errorCode: removeResult.errorCode,
          removedAt: startTime,
        };
      }

      return {
        success: true,
        subscriptionId,
        routerId,
        username,
        removedAt: startTime,
      };
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        subscriptionId,
        routerId,
        username,
        error: err,
        errorCode: "DEPROVISIONING_EXCEPTION",
        removedAt: startTime,
      };
    }
  }

  /**
   * Suspend a PPPoE user (disable account but keep configuration)
   * User can be resumed later without reconfiguration
   *
   * @param username PPPoE username to suspend
   */
  async suspend(username: string): Promise<MikroTikResponse<{ disabled: true }>> {
    const idResult = await this.findUserId(username);
    if (!idResult.success) return idResult as MikroTikResponse<{ disabled: true }>;

    const result = await this.mikrotikClient.run("/ppp/secret", "set", {
      numbers: idResult.data!,
      disabled: "yes",
    });

    if (!result.success) {
      return result as MikroTikResponse<{ disabled: true }>;
    }

    return {
      success: true,
      data: { disabled: true },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Resume a PPPoE user (enable account)
   * User can reconnect immediately
   *
   * @param username PPPoE username to resume
   */
  async resume(username: string): Promise<MikroTikResponse<{ disabled: false }>> {
    const idResult = await this.findUserId(username);
    if (!idResult.success) return idResult as MikroTikResponse<{ disabled: false }>;

    const result = await this.mikrotikClient.run("/ppp/secret", "set", {
      numbers: idResult.data!,
      disabled: "no",
    });

    if (!result.success) {
      return result as MikroTikResponse<{ disabled: false }>;
    }

    return {
      success: true,
      data: { disabled: false },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Moves an existing PPPoE secret onto a different profile (plan
   * upgrade/downgrade), creating the target profile first if it doesn't
   * already exist. Leaves password and enabled state untouched.
   */
  async updateProfile(username: string, profile: ProfileConfig): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    if (!this.mikrotikClient.isConnected()) {
      const connectResult = await this.mikrotikClient.connect();
      if (!connectResult.success) return { success: false, error: connectResult.error, errorCode: connectResult.errorCode };
    }
    const profileCheck = await this.ensureProfileExists(profile);
    if (!profileCheck.success) return profileCheck;

    const idResult = await this.findUserId(username);
    if (!idResult.success) return { success: false, error: idResult.error, errorCode: idResult.errorCode };

    const result = await this.mikrotikClient.run("/ppp/secret", "set", { numbers: idResult.data!, profile: profile.name });
    if (!result.success) return { success: false, error: result.error, errorCode: result.errorCode };

    // The /ppp/profile's rate-limit is a fallback ceiling — actual bandwidth
    // enforcement for an already-provisioned PPPoE user is the per-username
    // /queue/simple entry created at provision() time (see
    // setBandwidthLimit), which moving the secret to a new profile does not
    // touch on its own. Without this, a plan upgrade/downgrade would move
    // the account to the new profile but silently leave the customer capped
    // at their old plan's speed.
    const bandwidthResult = await this.updateBandwidth(username, profile.speedUpKbps, profile.speedDownKbps);
    if (!bandwidthResult.success) {
      // Non-critical, same convention as the initial-provisioning path
      // (Step 5 above): the account is on the correct profile either way,
      // so log and don't fail the whole plan change over the queue update —
      // it will still show up as a mismatch on the next manual/audit check.
      console.warn(`Warning: Failed to update bandwidth queue for ${username} after profile change: ${bandwidthResult.error ?? bandwidthResult.message}`);
    }

    return { success: true };
  }

  /** Sets a new password for an existing PPPoE secret (password reset). */
  async setPassword(username: string, newPassword: string): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    if (!this.mikrotikClient.isConnected()) {
      const connectResult = await this.mikrotikClient.connect();
      if (!connectResult.success) return { success: false, error: connectResult.error, errorCode: connectResult.errorCode };
    }
    const idResult = await this.findUserId(username);
    if (!idResult.success) return { success: false, error: idResult.error, errorCode: idResult.errorCode };

    const result = await this.mikrotikClient.run("/ppp/secret", "set", { numbers: idResult.data!, password: newPassword });
    if (!result.success) return { success: false, error: result.error, errorCode: result.errorCode };
    return { success: true };
  }

  /** Looks up a PPPoE secret's internal `.id` by name — RouterOS's `set`/`remove` commands require `numbers=<.id>`, not `name=`. */
  private async findUserId(username: string): Promise<MikroTikResponse<string>> {
    const findResult = await this.mikrotikClient.run("/ppp/secret", "print", { name: username });
    if (!findResult.success) return findResult as MikroTikResponse<string>;
    const users = Array.isArray(findResult.data) ? findResult.data : findResult.data ? [findResult.data] : [];
    if (users.length === 0) return { success: false, error: `User '${username}' not found`, errorCode: "USER_NOT_FOUND", timestamp: new Date().toISOString() };
    const id = (users[0] as Record<string, unknown>)[".id"] as string;
    return { success: true, data: id, timestamp: new Date().toISOString() };
  }

  /**
   * Update bandwidth limit for existing user
   * Useful for plan upgrades/downgrades mid-cycle
   *
   * @param username PPPoE username
   * @param speedUpKbps Upload speed in Kbps
   * @param speedDownKbps Download speed in Kbps
   */
  async updateBandwidth(
    username: string,
    speedUpKbps: number,
    speedDownKbps: number
  ): Promise<MikroTikResponse<{ updated: true }>> {
    if (speedUpKbps <= 0 || speedDownKbps <= 0) {
      return {
        success: false,
        errorCode: "INVALID_BANDWIDTH",
        message: "Upload and download speeds must be greater than 0",
        timestamp: new Date().toISOString(),
      };
    }

    // Remove old limit
    await this.removeBandwidthLimit(username).catch(() => {
      // Ignore if doesn't exist
    });

    // Apply new limit
    const result = await this.setBandwidthLimit(username, speedUpKbps, speedDownKbps);

    if (!result.success) {
      return { success: false, error: result.error, errorCode: result.errorCode, timestamp: new Date().toISOString() };
    }

    return {
      success: true,
      data: { updated: true },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get current status of a PPPoE user
   * Returns user configuration and whether they're currently connected
   *
   * @param username PPPoE username
   */
  async getUserStatus(
    username: string
  ): Promise<
    MikroTikResponse<{
      exists: boolean;
      disabled: boolean;
      profile: string;
      activeSession: boolean;
    }>
  > {
    try {
      // Check if user exists
      const userCheck = await this.checkUserExists(username);

      if (!userCheck.exists) {
        return {
          success: false,
          errorCode: "USER_NOT_FOUND",
          message: `User '${username}' not found`,
          timestamp: new Date().toISOString(),
        };
      }

      // Get user details
      const userDetails = await this.mikrotikClient.run("/ppp/secret", "print", {
        name: username,
      });

      if (!userDetails.success) {
        return userDetails;
      }

      const users = Array.isArray(userDetails.data)
        ? userDetails.data
        : [userDetails.data];
      const user = users[0] as Record<string, unknown>;

      // Check if user has active session
      const activeSessions = await this.mikrotikClient.run("/ppp/active", "print", {
        name: username,
      });

      const hasActiveSession =
        activeSessions.success &&
        Array.isArray(activeSessions.data) &&
        activeSessions.data.length > 0;

      return {
        success: true,
        data: {
          exists: true,
          disabled: user.disabled === "true" || user.disabled === true,
          profile: (user.profile as string) || "default",
          activeSession: hasActiveSession,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        errorCode: "STATUS_CHECK_FAILED",
        message: `Failed to get user status: ${err}`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * List all PPPoE users on the router
   * Useful for audits and reconciliation
   */
  async listAllUsers(): Promise<
    MikroTikResponse<
      Array<{
        name: string;
        profile: string;
        disabled: boolean;
      }>
    >
  > {
    const result = await this.mikrotikClient.run("/ppp/secret", "print", {
      service: "pppoe",
    });

    if (!result.success) {
      return result;
    }

    const users = Array.isArray(result.data) ? result.data : [result.data];

    const formatted = users.map((user: Record<string, unknown>) => ({
      name: user.name as string,
      profile: (user.profile as string) || "default",
      disabled: user.disabled === "true" || user.disabled === true,
    }));

    return {
      success: true,
      data: formatted,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Private helper: Check if a username already exists
   * Used for collision detection during provisioning
   */
  private async checkUserExists(
    username: string
  ): Promise<{ exists: boolean; userDetails?: Record<string, unknown> }> {
    const result = await this.mikrotikClient.run("/ppp/secret", "print", {
      name: username,
    });

    if (!result.success) {
      return { exists: false };
    }

    const users = Array.isArray(result.data) ? result.data : [result.data];

    if (users.length === 0) {
      return { exists: false };
    }

    return { exists: true, userDetails: users[0] as Record<string, unknown> };
  }

  /**
   * Private helper: Ensure PPPoE profile exists on router
   * Creates profile if it doesn't exist
   */
  private async ensureProfileExists(
    profile: ProfileConfig
  ): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    // Check if profile already exists
    const checkResult = await this.mikrotikClient.run(
      "/ppp/profile",
      "print",
      { name: profile.name }
    );

    if (checkResult.success) {
      const profiles = Array.isArray(checkResult.data)
        ? checkResult.data
        : [checkResult.data];
      if (profiles.length > 0) {
        return { success: true }; // Profile exists
      }
    }

    // Create profile with bandwidth limits
    const createResult = await this.mikrotikClient.run("/ppp/profile", "add", {
      name: profile.name,
      "rate-limit": `${profile.speedUpKbps}k/${profile.speedDownKbps}k`,
      "idle-timeout": profile.sessionTimeout || 0,
      comment: profile.comment || `Auto-created for PulseNet Billing`,
    });

    if (!createResult.success) {
      return {
        success: false,
        error: createResult.error,
        errorCode: createResult.errorCode,
      };
    }

    return { success: true };
  }

  /**
   * Private helper: Create a PPPoE user
   */
  private async createPPPoEUser(
    username: string,
    password: string,
    profile: string
  ): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    const result = await this.mikrotikClient.run("/ppp/secret", "add", {
      name: username,
      password: password,
      service: "pppoe",
      profile: profile,
      disabled: "no",
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        errorCode: result.errorCode,
      };
    }

    return { success: true };
  }

  /**
   * Private helper: Remove a PPPoE user
   */
  private async removePPPoEUser(
    username: string
  ): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    // Find user by name
    const findResult = await this.mikrotikClient.run("/ppp/secret", "print", {
      name: username,
    });

    if (!findResult.success) {
      return {
        success: false,
        error: findResult.error,
        errorCode: findResult.errorCode,
      };
    }

    const users = Array.isArray(findResult.data)
      ? findResult.data
      : [findResult.data];

    if (users.length === 0) {
      return {
        success: false,
        error: `User '${username}' not found`,
        errorCode: "USER_NOT_FOUND",
      };
    }

    const userId = (users[0] as Record<string, unknown>)[".id"];

    // Remove user
    const removeResult = await this.mikrotikClient.run("/ppp/secret", "remove", {
      numbers: userId,
    });

    if (!removeResult.success) {
      return {
        success: false,
        error: removeResult.error,
        errorCode: removeResult.errorCode,
      };
    }

    return { success: true };
  }

  /**
   * Private helper: Apply bandwidth limit using queue rules
   */
  private async setBandwidthLimit(
    username: string,
    speedUpKbps: number,
    speedDownKbps: number
  ): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    const rateLimit = `${speedUpKbps}k/${speedDownKbps}k`;

    const result = await this.mikrotikClient.run("/queue/simple", "add", {
      target: username,
      "max-packet-size": "2000",
      "rate-limit": rateLimit,
      "burst-limit": rateLimit,
      "burst-time": "30s",
      priority: "8",
      comment: `PulseNet Billing - ${username}`,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        errorCode: result.errorCode,
      };
    }

    return { success: true };
  }

  /**
   * Private helper: Remove bandwidth limit queue
   */
  private async removeBandwidthLimit(
    username: string
  ): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    // Find queue for this user
    const findResult = await this.mikrotikClient.run("/queue/simple", "print", {
      target: username,
    });

    if (!findResult.success) {
      return {
        success: false,
        error: findResult.error,
        errorCode: findResult.errorCode,
      };
    }

    const queues = Array.isArray(findResult.data)
      ? findResult.data
      : [findResult.data];

    if (queues.length === 0) {
      return { success: true }; // No queue to remove
    }

    const queueId = (queues[0] as Record<string, unknown>)[".id"];

    // Remove queue
    const removeResult = await this.mikrotikClient.run("/queue/simple", "remove", {
      numbers: queueId,
    });

    if (!removeResult.success) {
      return {
        success: false,
        error: removeResult.error,
        errorCode: removeResult.errorCode,
      };
    }

    return { success: true };
  }
}
