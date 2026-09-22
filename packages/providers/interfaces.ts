export interface PaymentIntent {
  providerReference: string;
  amount: string;
  currency: "USD";
  status: "PENDING" | "PAID" | "FAILED";
  paymentUrl?: string;
}

export type FiduciaryStatus = "PENDING" | "COMPLETED" | "FAILED" | "TIMEOUT" | "UNKNOWN" | "MISMATCH";
export type RefundProviderStatus = "PENDING" | "COMPLETED" | "FAILED" | "TIMEOUT" | "UNSUPPORTED";

export interface PaymentProvider {
  createPaymentIntent(input: {
    escrowId: string;
    amount: string;
    currency: "USD";
    idempotencyKey: string;
    paymentMethod?: string;
  }): Promise<PaymentIntent>;

  verifyWebhook(input: {
    rawBody: string;
    signature: string;
  }): Promise<{
    eventId: string;
    eventType: string;
    payload: unknown;
  }>;

  supportsRefund(paymentMethod?: string): boolean;

  refund(input: {
    paymentId: string;
    escrowId: string;
    amount: string;
    currency: string;
    idempotencyKey: string;
    reason?: string;
    paymentMethod?: string;
  }): Promise<{
    providerReference: string;
    status: RefundProviderStatus;
    failureCode?: string;
    failureReason?: string;
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
    currency?: string;
    idempotencyKey: string;
    recipientReference?: string;
  }): Promise<{
    providerReference: string;
    status: FiduciaryStatus;
    failureCode?: string;
    failureReason?: string;
  }>;

  requestRefund(input: {
    escrowId: string;
    amount: string;
    currency?: string;
    idempotencyKey: string;
    recipientReference?: string;
  }): Promise<{
    providerReference: string;
    status: FiduciaryStatus;
    failureCode?: string;
    failureReason?: string;
  }>;

  getTransactionStatus(input: {
    providerReference: string;
    escrowId?: string;
  }): Promise<{
    status: FiduciaryStatus;
    providerReference: string;
    amount?: string;
    currency?: string;
  }>;
}
