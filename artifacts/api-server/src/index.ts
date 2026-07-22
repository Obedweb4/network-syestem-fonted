import app from "./app";
import { logger } from "./lib/logger";
import { startExpiryEnforcement, startExpiryReminderSweep } from "./services/expiry-enforcement";
import { startProvisioningRetrySweep } from "./services/provisioning-engine";
import { startNotificationRetrySweep } from "./services/notification-retry";
import { startNocCollector } from "./services/noc-collector";
import { startNocAnalysisSweep } from "./services/noc-analysis";
import { startAutoRemediationSweep } from "./services/noc-actions";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startExpiryEnforcement();
  startExpiryReminderSweep();
  startProvisioningRetrySweep();
  startNotificationRetrySweep();
  startNocCollector();
  startNocAnalysisSweep();
  startAutoRemediationSweep();
});
