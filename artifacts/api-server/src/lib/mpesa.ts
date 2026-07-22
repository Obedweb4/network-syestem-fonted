import { logger } from "./logger";

/**
 * Safaricom Daraja (M-PESA) client: OAuth token handling + STK Push
 * initiation. Credentials come exclusively from environment variables —
 * MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY,
 * MPESA_ENVIRONMENT, MPESA_CALLBACK_URL — see .env.example. Nothing here is
 * ever hardcoded or logged in plaintext.
 */

export interface StkPushInitiateInput {
  /** Kenyan MSISDN, any of 07XXXXXXXX / 01XXXXXXXX / 2547XXXXXXXX / 2541XXXXXXXX. */
  phone: string;
  /** Whole-shilling amount (Daraja rejects decimals/zero). */
  amount: number;
  /** Shown to the customer and stored by Safaricom against the transaction — we use the customer's account number/id. */
  accountReference: string;
  /** Shown to the customer on the STK prompt. */
  transactionDesc: string;
}

export interface StkPushInitiateResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  responseCode: string;
  responseDescription: string;
  customerMessage: string;
}

export class MpesaConfigError extends Error {}
export class MpesaApiError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new MpesaConfigError(`${name} is not set. Configure it in the deployment secret store before initiating M-PESA payments.`);
  return value;
}

export interface MpesaCredentials {
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  callbackUrl: string;
  environment: "sandbox" | "production";
}

function envCredentials(): MpesaCredentials {
  return {
    consumerKey: requiredEnv("MPESA_CONSUMER_KEY"),
    consumerSecret: requiredEnv("MPESA_CONSUMER_SECRET"),
    shortcode: requiredEnv("MPESA_SHORTCODE"),
    passkey: requiredEnv("MPESA_PASSKEY"),
    callbackUrl: requiredEnv("MPESA_CALLBACK_URL"),
    environment: ((process.env.MPESA_ENVIRONMENT ?? "sandbox").toLowerCase() as "sandbox" | "production"),
  };
}

function daraJaBaseUrl(environment: string): string {
  if (environment === "production") return "https://api.safaricom.co.ke";
  if (environment === "sandbox") return "https://sandbox.safaricom.co.ke";
  throw new MpesaConfigError(`MPESA_ENVIRONMENT must be "sandbox" or "production", got "${environment}".`);
}

/** Converts 07XXXXXXXX / 01XXXXXXXX / +2547XXXXXXXX to Daraja's required 2547XXXXXXXX / 2541XXXXXXXX form. */
export function normalizeMsisdn(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (/^2547\d{8}$/.test(digits) || /^2541\d{8}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  throw new MpesaApiError(`"${phone}" is not a valid Kenyan M-PESA phone number.`);
}

function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// Takes a promise *factory* (not an already-started promise) so the
// AbortController's signal can actually be threaded into the request that
// needs to be cancelled — passing an already-created fetch() promise here
// previously meant abort() had nothing left to cancel, and the "timeout"
// never fired.
async function withTimeout<T>(makeRequest: (signal: AbortSignal) => Promise<T>, ms: number, label: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await makeRequest(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) throw new MpesaApiError(`${label} timed out after ${ms}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// In-memory OAuth token cache, keyed by which credential set generated the
// token — a single global cache would be actively wrong once more than one
// consumer key/secret pair can be in use (a cached env-var token being
// reused for a tenant's own Daraja app, or vice versa, since Daraja tokens
// are only valid for the app that requested them). Daraja tokens are
// typically valid ~1 hour; this is a single-process API server (see
// index.ts), so an in-memory Map is sufficient.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(credentials: MpesaCredentials): Promise<string> {
  const cacheKey = credentials.consumerKey;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const auth = Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`).toString("base64");

  const response = await withTimeout(
    (signal) =>
      fetch(`${daraJaBaseUrl(credentials.environment)}/oauth/v1/generate?grant_type=client_credentials`, {
        method: "GET",
        headers: { Authorization: `Basic ${auth}` },
        signal,
      }),
    10_000,
    "Daraja OAuth token request",
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new MpesaApiError(`Daraja OAuth token request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: string };
  if (!data.access_token) throw new MpesaApiError("Daraja OAuth response did not include an access_token");

  const expiresInSeconds = Number(data.expires_in ?? "3599");
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + expiresInSeconds * 1000 });
  return data.access_token;
}

/**
 * Initiates an STK Push (Lipa na M-PESA Online). Throws MpesaConfigError if
 * no credentials are available (neither passed in nor set via env vars), or
 * MpesaApiError if Daraja rejects/fails the request. The caller is
 * responsible for persisting the returned checkoutRequestId and waiting for
 * the callback — this function does not know about payment status, only
 * that the push was successfully sent to the customer's phone.
 *
 * `credentials` is optional so every existing call site keeps working
 * unchanged (env-var behavior exactly as before); pass a tenant's own
 * resolved credentials (see lib/mpesa-config.ts) to use their own Paybill/
 * Till instead of the deployment-wide default.
 */
export async function initiateStkPush(input: StkPushInitiateInput, credentials?: MpesaCredentials): Promise<StkPushInitiateResult> {
  const creds = credentials ?? envCredentials();
  const { shortcode, passkey, callbackUrl } = creds;

  const msisdn = normalizeMsisdn(input.phone);
  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new MpesaApiError(`Invalid STK push amount: ${input.amount}`);

  const ts = timestamp();
  const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString("base64");
  const token = await getAccessToken(creds);

  const requestBody = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: ts,
    TransactionType: "CustomerPayBillOnline",
    Amount: amount,
    PartyA: msisdn,
    PartyB: shortcode,
    PhoneNumber: msisdn,
    CallBackURL: callbackUrl,
    AccountReference: input.accountReference.slice(0, 12),
    TransactionDesc: input.transactionDesc.slice(0, 13),
  };

  let response: Response;
  try {
    response = await withTimeout(
      (signal) =>
        fetch(`${daraJaBaseUrl(creds.environment)}/mpesa/stkpush/v1/processrequest`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal,
        }),
      15_000,
      "Daraja STK push request",
    );
  } catch (err) {
    logger.error({ err }, "Daraja STK push request failed to send");
    throw new MpesaApiError("Could not reach the M-PESA payment gateway. Please try again.", err);
  }

  const raw = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok || !raw || raw.ResponseCode !== "0") {
    const description = (raw?.errorMessage as string) ?? (raw?.ResponseDescription as string) ?? `HTTP ${response.status}`;
    throw new MpesaApiError(`Daraja rejected the STK push request: ${description}`);
  }

  return {
    merchantRequestId: String(raw.MerchantRequestID),
    checkoutRequestId: String(raw.CheckoutRequestID),
    responseCode: String(raw.ResponseCode),
    responseDescription: String(raw.ResponseDescription ?? ""),
    customerMessage: String(raw.CustomerMessage ?? ""),
  };
}

/**
 * Shape Safaricom POSTs to MPESA_CALLBACK_URL. `CallbackMetadata.Item` is
 * only present when ResultCode === 0 (payment succeeded).
 */
export interface DarajaStkCallback {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{ Name: string; Value?: string | number }>;
      };
    };
  };
}

export interface ParsedStkCallback {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  success: boolean;
  amount?: number;
  mpesaReceiptNumber?: string;
  transactionDate?: string;
  phoneNumber?: string;
}

/** Narrows + extracts an unauthenticated request body into a typed callback, or returns null if it doesn't match Daraja's shape. */
export function parseStkCallback(body: unknown): ParsedStkCallback | null {
  const cb = (body as Partial<DarajaStkCallback> | null)?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== "string" || typeof cb.ResultCode !== "number") return null;

  const items = cb.CallbackMetadata?.Item ?? [];
  const find = (name: string) => items.find((i) => i.Name === name)?.Value;

  return {
    merchantRequestId: cb.MerchantRequestID,
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: cb.ResultCode,
    resultDesc: cb.ResultDesc,
    success: cb.ResultCode === 0,
    amount: typeof find("Amount") === "number" ? (find("Amount") as number) : undefined,
    mpesaReceiptNumber: typeof find("MpesaReceiptNumber") === "string" ? (find("MpesaReceiptNumber") as string) : undefined,
    transactionDate: find("TransactionDate") !== undefined ? String(find("TransactionDate")) : undefined,
    phoneNumber: find("PhoneNumber") !== undefined ? String(find("PhoneNumber")) : undefined,
  };
}
