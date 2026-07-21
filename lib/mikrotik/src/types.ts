/**
 * Type definitions for MikroTik integration
 */

export interface RouterConfig {
  id: string;
  ipAddress: string;
  apiPort: number;
  apiUsername: string;
  apiSecret: string; // encrypted in DB, decrypted before use
  tenantId: string;
  name: string;
}

/**
 * Response wrapper for all MikroTik operations
 */
export interface MikroTikResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  message?: string;
  timestamp: string;
}

/**
 * PPPoE user in MikroTik
 */
export interface PPPoEUser {
  ".id": string; // RouterOS internal ID (e.g., *1, *2)
  name: string;
  service: string; // "pppoe", "hotspot", etc.
  disabled: boolean;
  profile?: string;
  password?: string;
  createdAt?: string;
}

/**
 * Active PPPoE session
 */
export interface PPPoESession {
  ".id": string;
  name: string;
  service: string;
  caller_id: string; // Client IP
  uptime?: string;
  address?: string;
  bytes_in?: number;
  bytes_out?: number;
}

/**
 * Queue rule for bandwidth limiting
 */
export interface BandwidthQueue {
  ".id": string;
  target: string; // username or IP
  max_packet_size?: string;
  rate_limit?: string; // e.g., "10M/10M"
  burst_limit?: string;
  burst_time?: string;
  priority?: string;
}

/**
 * Router resource statistics
 */
export interface RouterStats {
  uptime: string;
  cpu_count: number;
  cpu_frequency: number;
  board_name: string;
  version: string;
  build_time: string;
  total_memory: number; // bytes
  free_memory: number; // bytes
  total_hdd_space?: number; // bytes
  free_hdd_space?: number; // bytes
}

/**
 * MikroTik operation result
 */
export interface OperationResult {
  success: boolean;
  message: string;
  command: string;
  executedAt: string;
}

/**
 * Connection error details
 */
export interface ConnectionError {
  code: "ECONNREFUSED" | "ETIMEOUT" | "EAUTH" | "UNKNOWN";
  message: string;
  routerIP: string;
  routerPort: number;
}
