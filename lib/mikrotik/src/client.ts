import { RouterOSAPI } from "node-routeros";
import type { RouterConfig, MikroTikResponse } from "./types";

/**
 * Production-grade MikroTik RouterOS API Client
 * 
 * Responsibilities:
 * - Manage RouterOS API connections with exponential backoff retry
 * - Execute commands with error normalization
 * - Provide stable foundation for PPPoE, Hotspot, and bandwidth operations
 * 
 * NOT responsible for:
 * - Database interactions
 * - Business logic (provisioning, subscription lifecycle)
 * - User/credential management beyond API calls
 */
export class MikroTikClient {
  private client: RouterOSAPI | null = null;
  private router: RouterConfig;
  private connected = false;

  // Configuration
  private readonly maxRetries = 3;
  private readonly initialRetryDelayMs = 500;
  private readonly commandTimeoutMs = 30000;
  private readonly connectionTimeoutMs = 10000;

  constructor(router: RouterConfig) {
    this.router = router;
  }

  /**
   * Connect to MikroTik RouterOS with exponential backoff retry
   * 
   * Retry strategy:
   * - Attempt 1: 500ms delay
   * - Attempt 2: 1000ms delay (500 * 2^1)
   * - Attempt 3: 2000ms delay (500 * 2^2)
   * 
   * Total max wait: ~3.5 seconds + API timeouts
   */
  async connect(): Promise<MikroTikResponse<{ connected: true }>> {
    if (this.connected && this.client) {
      return {
        success: true,
        data: { connected: true },
        timestamp: new Date().toISOString(),
      };
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Create new connection
        this.client = new RouterOSAPI({
          host: this.router.ipAddress,
          port: this.router.apiPort,
          user: this.router.apiUsername,
          password: this.router.apiSecret,
          timeout: this.connectionTimeoutMs / 1000,
        });

        await this.client.connect();

        // Mark connected before the verification call below, since run()
        // short-circuits with NOT_CONNECTED/CONNECTION_LOST otherwise.
        this.connected = true;

        // Verify connection works by querying system identity
        // This ensures credentials are valid and API is responsive
        const identityCheck = await this.run("/system/identity", "print", {});
        if (!identityCheck.success) {
          throw new Error(identityCheck.message ?? identityCheck.error ?? "Identity check failed");
        }

        return {
          success: true,
          data: { connected: true },
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.maxRetries) {
          // Exponential backoff: 500ms, 1s, 2s
          const delayMs = this.initialRetryDelayMs * Math.pow(2, attempt - 1);
          await this.sleep(delayMs);
          // Continue to next attempt
          continue;
        }
      }
    }

    // All retries exhausted
    this.connected = false;
    this.client = null;

    return {
      success: false,
      error: this.normalizeError(lastError),
      errorCode: "CONNECTION_FAILED",
      message: `Failed to connect to ${this.router.ipAddress}:${this.router.apiPort} after ${this.maxRetries} attempts: ${lastError?.message}`,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Disconnect from MikroTik RouterOS
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        // Silently ignore disconnect errors
      } finally {
        this.client = null;
        this.connected = false;
      }
    }
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  /**
   * Generic command executor
   * 
   * @param path RouterOS API path (e.g., "/ppp/secret", "/queue/simple")
   * @param command Command to execute (e.g., "print", "add", "set", "remove")
   * @param params Command parameters as key-value object
   * 
   * @returns Raw RouterOS response data
   * 
   * @throws Error if not connected or command execution fails
   * 
   * @example
   * // List all PPPoE users
   * const users = await client.run("/ppp/secret", "print", { service: "pppoe" });
   * 
   * // Create a PPPoE user
   * const newUserId = await client.run("/ppp/secret", "add", {
   *   name: "user1",
   *   password: "pass123",
   *   service: "pppoe",
   *   profile: "default"
   * });
   */
  async run(
    path: string,
    command: string,
    params: Record<string, unknown>
  ): Promise<MikroTikResponse<unknown>> {
    if (!this.client) {
      return {
        success: false,
        error: "Not connected",
        errorCode: "NOT_CONNECTED",
        message: "MikroTik client not connected. Call connect() first.",
        timestamp: new Date().toISOString(),
      };
    }

    if (!this.connected) {
      return {
        success: false,
        error: "Connection lost",
        errorCode: "CONNECTION_LOST",
        message: "Connection to MikroTik was unexpectedly closed.",
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const result = await this.executeWithTimeout(path, command, params);

      return {
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Check if it's a connection error - mark as disconnected
      if (
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("ECONNRESET") ||
        err.message.includes("timeout")
      ) {
        this.connected = false;
      }

      return {
        success: false,
        error: this.normalizeError(err),
        errorCode: this.getErrorCode(err),
        message: `Command failed: ${err.message}`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Build a RouterOS API "sentence" (array of word strings) from a path,
   * command and params object, following the node-routeros write() format.
   *
   * - print commands use `?key=value` filter words
   * - add/set/remove commands use `=key=value` assignment words
   *
   * @private
   */
  private buildSentence(
    path: string,
    command: string,
    params: Record<string, unknown>
  ): string[] {
    const sentence = [`${path}/${command}`];
    const prefix = command === "print" ? "?" : "=";

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      sentence.push(`${prefix}${key}=${String(value)}`);
    }

    return sentence;
  }

  /**
   * Execute command with timeout to prevent hanging
   * 
   * @private
   */
  private executeWithTimeout(
    path: string,
    command: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error("Client not initialized"));
        return;
      }

      let completed = false;
      const timeoutHandle = setTimeout(() => {
        if (!completed) {
          completed = true;
          reject(new Error(`Command timeout after ${this.commandTimeoutMs}ms`));
        }
      }, this.commandTimeoutMs);

      const sentence = this.buildSentence(path, command, params);

      this.client
        .write(sentence)
        .then((data) => {
          if (completed) return;
          completed = true;
          clearTimeout(timeoutHandle);
          resolve(data);
        })
        .catch((err: Error) => {
          if (completed) return;
          completed = true;
          clearTimeout(timeoutHandle);
          reject(err);
        });
    });
  }

  /**
   * Get appropriate error code based on error type
   * 
   * @private
   */
  private getErrorCode(error: Error): string {
    const message = error.message.toLowerCase();

    if (message.includes("unauthorized") || message.includes("auth")) {
      return "AUTHENTICATION_FAILED";
    }

    if (message.includes("timeout")) {
      return "COMMAND_TIMEOUT";
    }

    if (
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("enotfound")
    ) {
      return "CONNECTION_FAILED";
    }

    if (message.includes("no such command")) {
      return "INVALID_COMMAND";
    }

    if (message.includes("no such item")) {
      return "NOT_FOUND";
    }

    if (message.includes("already exists")) {
      return "ALREADY_EXISTS";
    }

    if (message.includes("invalid")) {
      return "INVALID_PARAMETER";
    }

    return "COMMAND_FAILED";
  }

  /**
   * Normalize error to safe string (no credential leakage)
   * 
   * @private
   */
  private normalizeError(error: Error | null): string {
    if (!error) {
      return "Unknown error";
    }

    let message = error.message;

    // Remove sensitive information
    message = message.replace(this.router.apiSecret, "***");
    message = message.replace(this.router.apiUsername, "***");
    message = message.replace(this.router.ipAddress, "***");

    return message;
  }

  /**
   * Sleep utility for retry backoff
   * 
   * @private
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get router configuration (for debugging/logging)
   * Non-sensitive fields only
   */
  getRouterInfo(): {
    name: string;
    ipAddress: string;
    apiPort: number;
    connected: boolean;
  } {
    return {
      name: this.router.name,
      ipAddress: this.router.ipAddress,
      apiPort: this.router.apiPort,
      connected: this.isConnected(),
    };
  }
}
