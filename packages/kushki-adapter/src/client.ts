export interface KushkiConfig {
  merchantId: string;
  isProduction?: boolean;
}

export interface KushkiChargeRequest {
  token: string;
  amount: {
    subtotalIva0: number;
    subtotalIva?: number;
    iva?: number;
    currency: string;
  };
  contactDetails?: {
    email?: string;
  };
}

export interface KushkiTransferInitRequest {
  amount: {
    subtotalIva0: number;
    subtotalIva?: number;
    iva?: number;
    currency: string;
  };
  callbackUrl: string;
  userType: "0" | "1";
  documentType: string;
  documentNumber: string;
  paymentDescription: string;
  email: string;
  currency: string;
}

export interface KushkiResponse {
  ticketNumber?: string;
  status?: string;
  details?: {
    responseCode?: string;
  };
  secureValidation?: {
    type?: string;
    acsURL?: string;
  };
}

export class KushkiClient {
  private readonly baseUrl: string;
  private readonly merchantId: string;

  constructor(config: KushkiConfig) {
    this.merchantId = config.merchantId;
    this.baseUrl = config.isProduction
      ? "https://api.kushkipagos.com"
      : "https://api-uat.kushkipagos.com";
  }

  private async request<T>(endpoint: string, method: string, payload: unknown, idempotencyKey: string): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Private-Merchant-Id": this.merchantId,
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorBody = {};
        try {
          errorBody = await response.json();
        } catch {
          // Ignore
        }
        throw new Error(`Kushki API Error: ${response.status} - ${JSON.stringify(errorBody)}`);
      }

      return await response.json() as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async chargeCard(request: KushkiChargeRequest, idempotencyKey: string): Promise<KushkiResponse> {
    return this.request<KushkiResponse>("/card/v1/charges", "POST", request, idempotencyKey);
  }

  async initTransfer(request: KushkiTransferInitRequest, idempotencyKey: string): Promise<KushkiResponse> {
    return this.request<KushkiResponse>("/transfer/v1/init", "POST", request, idempotencyKey);
  }
}
