import { logger } from "./logger";
import { startRadiusUdpServers } from "./udp-server";

const authPort = Number(process.env.RADIUS_AUTH_PORT ?? 1812);
const acctPort = Number(process.env.RADIUS_ACCT_PORT ?? 1813);
const host = process.env.RADIUS_BIND_HOST ?? "0.0.0.0";

if (Number.isNaN(authPort) || Number.isNaN(acctPort)) {
  throw new Error("RADIUS_AUTH_PORT / RADIUS_ACCT_PORT must be numeric if set.");
}

if (!process.env.PROVISIONING_CREDENTIAL_KEY) {
  // This process decrypts the same PPPoE/Hotspot passwords and RADIUS
  // shared secrets api-server does, with the same key. Fail fast rather
  // than start a listener that will reject every request.
  throw new Error(
    "PROVISIONING_CREDENTIAL_KEY is not set. Generate one with `openssl rand -base64 32` — it must be the exact same value api-server uses.",
  );
}

startRadiusUdpServers({ authPort, acctPort, host, logger }).catch((err) => {
  logger.error({ err }, "Failed to start RADIUS UDP listeners");
  process.exit(1);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
