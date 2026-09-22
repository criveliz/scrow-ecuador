export type PaymentStatusType =
  | "PENDING"
  | "PROCESSING"
  | "APPROVED"
  | "DECLINED"
  | "FAILED"
  | "CANCELLED";

export interface PaymentIntent {
  providerReference: string;
  amount: string;
  currency: "USD";
  status: PaymentStatusType;
  paymentUrl?: string;
  token?: string;
  checkoutData?: Record<string, unknown>;
  rawResponse?: Record<string, unknown>;
}

export interface InitiatePaymentInput {
  escrowId: string;
  amount: string;
  currency: "USD";
  idempotencyKey: string;
  token?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentProvider {
  createPaymentIntent(input: InitiatePaymentInput): Promise<PaymentIntent>;

  getPaymentStatus?(providerReference: string): Promise<PaymentIntent>;

  verifyWebhook(input: {
    rawBody: string;
    signature: string;
  }): Promise<{
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
