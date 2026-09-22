import type {
  InitiatePaymentInput,
  PaymentIntent,
  PaymentProvider,
  PaymentStatusType,
} from "./interfaces.js";

export interface KushkiConfig {
  privateMerchantId?: string;
  publicMerchantId?: string;
  environment?: "sandbox" | "production";
  baseUrl?: string;
  timeoutMs?: number;
}

export class KushkiClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown
  ) {
    super(message);
    this.name = "KushkiClientError";
  }
}

export class KushkiMapper {
  static mapStatus(kushkiStatus?: string): PaymentStatusType {
    if (!kushkiStatus) return "PENDING";
    const upper = kushkiStatus.toUpperCase();

    switch (upper) {
      case "APPROVAL":
      case "APPROVED":
      case "000":
        return "APPROVED";
      case "DECLINED":
      case "REJECTED":
        return "DECLINED";
      case "PROCESSING":
      case "IN_PROGRESS":
        return "PROCESSING";
      case "FAILED":
      case "ERROR":
        return "FAILED";
      case "CANCELLED":
        return "CANCELLED";
      case "PENDING":
      default:
        return "PENDING";
    }
  }

  static sanitizeResponse(data: Record<string, unknown>): Record<string, unknown> {
    const sanitized = { ...data };
    const sensitiveKeys = [
      "cvv",
      "pan",
      "cardnumber",
      "card_number",
      "privatemerchantid",
      "private_merchant_id",
      "secret",
      "password",
    ];

    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.includes(key.toLowerCase())) {
        delete sanitized[key];
      } else if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
        sanitized[key] = KushkiMapper.sanitizeResponse(sanitized[key] as Record<string, unknown>);
      }
    }
    return sanitized;
  }
}

export class KushkiClient {
  private readonly baseUrl: string;
  private readonly privateMerchantId: string;
  private readonly timeoutMs: number;

  constructor(config?: KushkiConfig) {
    const env = config?.environment || (process.env.KUSHKI_ENVIRONMENT as "sandbox" | "production") || "sandbox";
    const defaultUrl = env === "production"
      ? "https://api.kushkipagosoficial.com"
      : "https://api-uat.kushkipagosoficial.com";

    this.baseUrl = config?.baseUrl || process.env.KUSHKI_API_BASE_URL || defaultUrl;
    this.privateMerchantId = config?.privateMerchantId || process.env.KUSHKI_PRIVATE_MERCHANT_ID || "mock-private-merchant-id";
    this.timeoutMs = config?.timeoutMs || 10000;
  }

  async request<T = Record<string, unknown>>(
    endpoint: string,
    options: {
      method: "GET" | "POST" | "PUT";
      body?: Record<string, unknown>;
      headers?: Record<string, string>;
    }
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
      "Private-Merchant-Id": this.privateMerchantId,
      ...(options.headers || {}),
    };

    try {
      const response = await fetch(url, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      let responseData: any;
      try {
        responseData = await response.json();
      } catch {
        responseData = { message: "Non-JSON response received from Kushki" };
      }

      if (!response.ok) {
        const sanitizedError = KushkiMapper.sanitizeResponse(
          typeof responseData === "object" ? responseData : { message: String(responseData) }
        );
        throw new KushkiClientError(
          sanitizedError.message ? String(sanitizedError.message) : `Kushki API error (${response.status})`,
          response.status,
          sanitizedError
        );
      }

      return KushkiMapper.sanitizeResponse(responseData) as T;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        throw new KushkiClientError(`Kushki API request timed out after ${this.timeoutMs}ms`, 504);
      }
      if (err instanceof KushkiClientError) {
        throw err;
      }
      throw new KushkiClientError(`Network or connection error contacting Kushki: ${err.message}`, 502);
    }
  }
}

export class KushkiPaymentProvider implements PaymentProvider {
  private readonly client: KushkiClient;

  constructor(config?: KushkiConfig, client?: KushkiClient) {
    this.client = client || new KushkiClient(config);
  }

  async createPaymentIntent(input: InitiatePaymentInput): Promise<PaymentIntent> {
    const amountNum = parseFloat(input.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error("Invalid payment amount for Kushki payment intent");
    }

    const formattedAmount = amountNum.toFixed(2);

    const payload = {
      token: input.token || `mock-token-${input.escrowId}`,
      amount: {
        subtotalIva: 0,
        subtotalIva0: amountNum,
        ice: 0,
        iva: 0,
        currency: input.currency,
      },
      metadata: {
        escrowId: input.escrowId,
        idempotencyKey: input.idempotencyKey,
        ...(input.metadata || {}),
      },
      fullResponse: true,
    };

    let response: Record<string, any>;
    try {
      response = await this.client.request<Record<string, any>>("/card/v1/charges", {
        method: "POST",
        body: payload,
        headers: {
          "X-Request-Id": input.idempotencyKey,
        },
      });
    } catch (err: any) {
      if (err instanceof KushkiClientError) {
        return {
          providerReference: `kushki-err-${input.escrowId}`,
          amount: formattedAmount,
          currency: input.currency,
          status: "FAILED",
          rawResponse: { error: err.message, statusCode: err.statusCode, details: err.responseBody },
        };
      }
      throw err;
    }

    const ticketNumber = response.ticketNumber || response.transactionId || `kushki-${Date.now()}`;
    const mappedStatus = KushkiMapper.mapStatus(response.status || response.transactionStatus);

    return {
      providerReference: String(ticketNumber),
      amount: formattedAmount,
      currency: input.currency,
      status: mappedStatus,
      paymentUrl: response.paymentUrl || `https://pay.kushki.com/checkout/${ticketNumber}`,
      token: input.token,
      checkoutData: {
        ticketNumber,
        status: response.status || "PENDING",
      },
      rawResponse: response,
    };
  }

  async getPaymentStatus(providerReference: string): Promise<PaymentIntent> {
    const response = await this.client.request<Record<string, any>>(`/card/v1/charges/${providerReference}`, {
      method: "GET",
    });

    const mappedStatus = KushkiMapper.mapStatus(response.status || response.transactionStatus);

    return {
      providerReference,
      amount: response.amount ? String(response.amount.subtotalIva0 || response.amount) : "0.00",
      currency: "USD",
      status: mappedStatus,
      rawResponse: response,
    };
  }

  async verifyWebhook(input: { rawBody: string; signature: string }) {
    if (!input.signature) {
      throw new Error("Missing Kushki webhook signature");
    }
    const payload = JSON.parse(input.rawBody);
    return {
      eventId: payload.eventId || `kushki-event-${Date.now()}`,
      eventType: payload.eventType || "payment.processed",
      payload,
    };
  }
}
