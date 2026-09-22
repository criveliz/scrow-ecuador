import type {
  FiduciaryProvider,
  InitiatePaymentInput,
  PaymentIntent,
  PaymentProvider,
  PaymentStatusType,
} from "./interfaces.js";

export type MockPaymentMode =
  | "SUCCESS"
  | "PENDING"
  | "APPROVED"
  | "DECLINED"
  | "FAILED"
  | "TIMEOUT"
  | "HTTP_400"
  | "HTTP_500";

export class MockPaymentProvider implements PaymentProvider {
  public mode: MockPaymentMode = "PENDING";

  constructor(mode: MockPaymentMode = "PENDING") {
    this.mode = mode;
  }

  async createPaymentIntent(input: InitiatePaymentInput): Promise<PaymentIntent> {
    if (this.mode === "TIMEOUT") {
      throw new Error("Provider request timed out after 10000ms");
    }

    if (this.mode === "HTTP_400") {
      throw new Error("Kushki API error (400): Invalid request parameter");
    }

    if (this.mode === "HTTP_500") {
      throw new Error("Kushki API error (500): Internal payment gateway error");
    }

    let status: PaymentStatusType = "PENDING";
    if (this.mode === "APPROVED" || this.mode === "SUCCESS") status = "APPROVED";
    if (this.mode === "DECLINED") status = "DECLINED";
    if (this.mode === "FAILED") status = "FAILED";

    return {
      providerReference: `mock-pay-${input.escrowId}`,
      amount: input.amount,
      currency: input.currency,
      status,
      paymentUrl: `http://localhost:3000/pay/${input.escrowId}`,
      checkoutData: {
        escrowId: input.escrowId,
        idempotencyKey: input.idempotencyKey,
        mode: this.mode,
      },
    };
  }

  async getPaymentStatus(providerReference: string): Promise<PaymentIntent> {
    let status: PaymentStatusType = "PENDING";
    if (this.mode === "APPROVED" || this.mode === "SUCCESS") status = "APPROVED";
    if (this.mode === "DECLINED") status = "DECLINED";
    if (this.mode === "FAILED") status = "FAILED";

    return {
      providerReference,
      amount: "100.00",
      currency: "USD",
      status,
    };
  }

  async verifyWebhook(input: { rawBody: string; signature: string }) {
    if (!input.signature) throw new Error("Missing mock webhook signature");
    return {
      eventId: `mock-event-${Date.now()}`,
      eventType: "payment.succeeded",
      payload: JSON.parse(input.rawBody),
    };
  }
}

export class MockFiduciaryProvider implements FiduciaryProvider {
  async verifyIncomingFunds() {
    return { confirmed: true, providerReference: "mock-funds-confirmed" };
  }

  async requestRelease(input: { escrowId: string; amount: string; idempotencyKey: string }) {
    return {
      providerReference: `mock-release-${input.escrowId}`,
      status: "PENDING" as const,
    };
  }

  async requestRefund(input: { escrowId: string; amount: string; idempotencyKey: string }) {
    return {
      providerReference: `mock-refund-${input.escrowId}`,
      status: "PENDING" as const,
    };
  }
}
