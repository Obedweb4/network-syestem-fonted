import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { nocSettingsTable, type NocSettings } from "@workspace/db/schema";

const DEFAULTS: Omit<NocSettings, "tenantId" | "updatedAt"> = {
  autoRemediationEnabled: false,
  llmNarrativeEnabled: true,
  pollIntervalSeconds: 60,
  analysisIntervalSeconds: 180,
  snapshotRetentionDays: 90,
};

/** Returns the tenant's saved NOC settings, or the schema defaults (unsaved — no row is created just by reading) if they haven't configured anything yet. Every NOC subsystem should read config through this rather than querying `noc_settings` directly, so "no row yet" always means the same thing everywhere. */
export async function getNocSettings(tenantId: string): Promise<NocSettings> {
  const [row] = await db.select().from(nocSettingsTable).where(eq(nocSettingsTable.tenantId, tenantId)).limit(1);
  if (row) return row;
  return { tenantId, updatedAt: new Date(), ...DEFAULTS };
}
