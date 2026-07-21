export * from "./generated/api";

// NOTE: getHotspotSessionsParams, getRouterAlertsParams, listVouchersParams,
// portalLogoutBody, and portalRefreshTokenBody are intentionally excluded below.
// Orval names both the (value) zod schema for the PATH params and the
// (type-only) TS interface for the QUERY params identically for some operations
// (those with both a path id and query params), causing a TS2308
// ambiguous-export collision when re-exported via a blanket `export *`.
// The portal operations (logout, refresh) also collide between body types and
// generated zod schemas. The zod schemas from "./generated/api" are what routes
// actually use, so the colliding query-only type aliases are dropped here.
// If codegen is re-run and this list needs updating, diff the generated/types/
// directory against what is exported here.
export type * from "./generated/types/activityItem";
export type * from "./generated/types/aiAnalysis";
export type * from "./generated/types/authTokens";
export type * from "./generated/types/authUserResponse";
export type * from "./generated/types/authUser";
export type * from "./generated/types/loyaltyDetail";
export type * from "./generated/types/loyaltyTransaction";
export type * from "./generated/types/customerAuthTokenResponseCustomer";
export type * from "./generated/types/customerAuthTokenResponse";
export type * from "./generated/types/customerCurrentSessionResponseSession";
export type * from "./generated/types/customerCurrentSessionResponse";
export type * from "./generated/types/customerDashboardDataActiveSession";
export type * from "./generated/types/customerDashboardDataLoyalty";
export type * from "./generated/types/customerDashboardData";
export type * from "./generated/types/customerDashboardDataWallet";
export type * from "./generated/types/customerDetail";
export type * from "./generated/types/customerInput";
export type * from "./generated/types/customerLoyaltyDataTransactionsItem";
export type * from "./generated/types/customerLoyaltyData";
export type * from "./generated/types/customerPage";
export type * from "./generated/types/customerPortalCredentials";
export type * from "./generated/types/customerPortalProfileLoyalty";
export type * from "./generated/types/customerPortalProfile";
export type * from "./generated/types/customerPortalProfileWallet";
export type * from "./generated/types/customerSessionRecord";
export type * from "./generated/types/customerTokenRefreshResponse";
export type * from "./generated/types/customer";
export type * from "./generated/types/customerUpdate";
export type * from "./generated/types/dashboardSummary";
export type * from "./generated/types/errorResponse";
export type * from "./generated/types/forgotPasswordInput";
export type * from "./generated/types/getPortalSessionHistoryParams";
export type * from "./generated/types/healthStatus";
export type * from "./generated/types/hotspotPackagePublic";
export type * from "./generated/types/hotspotSession";
export type * from "./generated/types/invoiceInput";
export type * from "./generated/types/invoicePage";
export type * from "./generated/types/invoiceStatus";
export type * from "./generated/types/invoice";
export type * from "./generated/types/invoiceUpdateStatus";
export type * from "./generated/types/invoiceUpdate";
export type * from "./generated/types/listCustomersParams";
export type * from "./generated/types/listInvoicesParams";
export type * from "./generated/types/listInvoicesStatus";
export type * from "./generated/types/listNotificationLogsParams";
export type * from "./generated/types/listNotificationLogsStatus";
export type * from "./generated/types/listPlansParams";
export type * from "./generated/types/listPlansType";
export type * from "./generated/types/listPortalPackagesParams";
export type * from "./generated/types/listRoutersParams";
export type * from "./generated/types/listSubscriptionsParams";
export type * from "./generated/types/listSubscriptionsStatus";
export type * from "./generated/types/listUsersParams";
export type * from "./generated/types/listVoucherBatchesParams";
export type * from "./generated/types/listVouchersStatus";
export type * from "./generated/types/loginInput";
export type * from "./generated/types/loyaltyRedeemRequest";
export type * from "./generated/types/loyaltyRedeemResponseTransaction";
export type * from "./generated/types/loyaltyRedeemResponse";
export type * from "./generated/types/messageResponse";
export type * from "./generated/types/networkAlertSeverity";
export type * from "./generated/types/networkAlert";
export type * from "./generated/types/notificationLogChannel";
export type * from "./generated/types/notificationLogPage";
export type * from "./generated/types/notificationLogStatus";
export type * from "./generated/types/notificationLog";
export type * from "./generated/types/notificationTemplateChannel";
export type * from "./generated/types/notificationTemplateInputChannel";
export type * from "./generated/types/notificationTemplateInput";
export type * from "./generated/types/notificationTemplate";
export type * from "./generated/types/notificationTemplateUpdate";
export type * from "./generated/types/paymentInputMethod";
export type * from "./generated/types/paymentInput";
export type * from "./generated/types/paymentMethod";
export type * from "./generated/types/paymentStatus";
export type * from "./generated/types/payment";
export type * from "./generated/types/planInput";
export type * from "./generated/types/planInputType";
export type * from "./generated/types/planUpdate";
export type * from "./generated/types/refreshInput";
export type * from "./generated/types/resetPasswordInput";
export type * from "./generated/types/revenueDataPoint";
export type * from "./generated/types/routerAlertSeverity";
export type * from "./generated/types/routerAlert";
export type * from "./generated/types/routerDetail";
export type * from "./generated/types/routerInput";
export type * from "./generated/types/routerMetrics";
export type * from "./generated/types/router";
export type * from "./generated/types/routerUpdate";
export type * from "./generated/types/servicePlan";
export type * from "./generated/types/servicePlanType";
export type * from "./generated/types/signupInput";
export type * from "./generated/types/staffUserInput";
export type * from "./generated/types/staffUser";
export type * from "./generated/types/staffUserUpdate";
export type * from "./generated/types/subscriptionInput";
export type * from "./generated/types/subscriptionPage";
export type * from "./generated/types/subscriptionStats";
export type * from "./generated/types/subscriptionStatus";
export type * from "./generated/types/subscription";
export type * from "./generated/types/subscriptionUpdateStatus";
export type * from "./generated/types/subscriptionUpdate";
export type * from "./generated/types/voucherBatchDetail";
export type * from "./generated/types/voucherBatchInput";
export type * from "./generated/types/voucherBatch";
export type * from "./generated/types/voucherPage";
export type * from "./generated/types/voucherRedeemInput";
export type * from "./generated/types/voucherStatus";
export type * from "./generated/types/voucher";
export type * from "./generated/types/walletDetail";
export type * from "./generated/types/walletTransaction";
