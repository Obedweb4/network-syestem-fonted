import bcrypt from "bcrypt";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { customersTable, tenantsTable, usersTable, ROLES } from "@workspace/db/schema";

/**
 * Idempotent production bootstrap. Passwords are deliberately supplied only
 * through the secret store; this source file and deployment archive contain no
 * password value.
 */
const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "enoswebala27@gmail.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
const defaultCustomerPhone = process.env.SEED_CUSTOMER_PHONE ?? "0743901680";
const tenantName = process.env.SEED_TENANT_NAME ?? "PulseNet Billing";
const tenantSlug = process.env.SEED_TENANT_SLUG ?? "pulsenet";

if (!adminPassword || adminPassword.length < 8) {
  throw new Error("SEED_ADMIN_PASSWORD must be set to a password of at least 8 characters.");
}

try {
  await db.transaction(async (tx) => {
    let [tenant] = await tx.select().from(tenantsTable).where(eq(tenantsTable.slug, tenantSlug)).limit(1);
    if (!tenant) [tenant] = await tx.insert(tenantsTable).values({ name: tenantName, slug: tenantSlug }).returning();

    const [existingAdmin] = await tx.select().from(usersTable).where(eq(usersTable.email, adminEmail)).limit(1);
    if (!existingAdmin) {
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      await tx.insert(usersTable).values({
        tenantId: tenant.id, email: adminEmail, passwordHash,
        firstName: "PulseNet", lastName: "Administrator", roles: [ROLES.SUPER_ADMIN],
        status: "ACTIVE", isActive: true,
      });
      console.log(`Created administrator ${adminEmail}.`);
    } else {
      console.log(`Administrator ${adminEmail} already exists; password was not changed.`);
    }

    const [existingCustomer] = await tx.select().from(customersTable).where(and(
      eq(customersTable.tenantId, tenant.id), eq(customersTable.phone, defaultCustomerPhone),
    )).limit(1);
    if (!existingCustomer) {
      await tx.insert(customersTable).values({
        tenantId: tenant.id, firstName: "Default", lastName: "Customer", phone: defaultCustomerPhone,
      });
      console.log(`Created default customer ${defaultCustomerPhone}.`);
    } else {
      console.log(`Default customer ${defaultCustomerPhone} already exists.`);
    }
  });
} finally {
  await pool.end();
}
