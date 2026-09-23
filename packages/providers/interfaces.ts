export interface PaymentIntent {
  providerReference: string;
  amount: string;
  currency: "USD";
  status: "PENDING" | "PAID" | "FAILED";
  paymentUrl?: string;
}

export interface PaymentProvider {
  createPaymentIntent(input: {
    escrowId: string;
    amount: string;
    currency: "USD";
    idempotencyKey: string;
  }): Promise<PaymentIntent>;

  verifyWebhook(input: { rawBody: string; signature: string }): Promise<{
    eventId: string;
    eventType: string;
    payload: unknown;
  }>;
}

export interface FiduciaryProvider {
  verifyIncomingFunds(input: {
    escrowId: string;
    expectedAmount: string;
    reference: string;
  }): Promise<{
    confirmed: boolean;
    providerReference?: string;
  }>;

  requestRelease(input: {
    escrowId: string;
    amount: string;
    idempotencyKey: string;
  }): Promise<{
    providerReference: string;
    status: "PENDING" | "COMPLETED" | "FAILED";
  }>;

  requestRefund(input: {
    escrowId: string;
    amount: string;
    idempotencyKey: string;
  }): Promise<{
    providerReference: string;
    status: "PENDING" | "COMPLETED" | "FAILED";
  }>;
}
