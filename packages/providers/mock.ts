import type { FiduciaryProvider, PaymentProvider } from "./interfaces.js";

export class MockPaymentProvider implements PaymentProvider {
  async createPaymentIntent(input: {
    escrowId: string;
    amount: string;
    currency: "USD";
    idempotencyKey: string;
  }) {
    return {
      providerReference: `mock-pay-${input.escrowId}`,
      amount: input.amount,
      currency: input.currency,
      status: "PENDING" as const,
      paymentUrl: `http://localhost:3000/pay/${input.escrowId}`,
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

  async requestRelease(input: {
    escrowId: string;
    amount: string;
    idempotencyKey: string;
  }) {
    return {
      providerReference: `mock-release-${input.escrowId}`,
      status: "PENDING" as const,
    };
  }

  async requestRefund(input: {
    escrowId: string;
    amount: string;
    idempotencyKey: string;
  }) {
    return {
      providerReference: `mock-refund-${input.escrowId}`,
      status: "PENDING" as const,
    };
  }
}
