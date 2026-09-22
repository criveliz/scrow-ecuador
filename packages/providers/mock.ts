import type {
  FiduciaryProvider,
  FiduciaryStatus,
  PaymentIntent,
  PaymentProvider,
  RefundProviderStatus,
} from "./interfaces.js";

export type MockFiduciaryMode = "SUCCESS" | "PENDING" | "FAILED" | "TIMEOUT" | "DUPLICATE" | "MISMATCH" | "UNKNOWN";
export type MockRefundMode = "SUCCESS" | "PENDING" | "FAILED" | "TIMEOUT" | "DUPLICATE" | "UNSUPPORTED";

export class MockPaymentProvider implements PaymentProvider {
  public refundMode: MockRefundMode = "SUCCESS";
  public supportedMethods: Set<string> = new Set(["CARD", "CREDIT_CARD", "DEBIT_CARD"]);
  public calls: {
    createPaymentIntent: number;
    verifyWebhook: number;
    refund: Array<Record<string, unknown>>;
  } = {
    createPaymentIntent: 0,
    verifyWebhook: 0,
    refund: [],
  };

  async createPaymentIntent(input: {
    escrowId: string;
    amount: string;
    currency: "USD";
    idempotencyKey: string;
    paymentMethod?: string;
  }): Promise<PaymentIntent> {
    this.calls.createPaymentIntent++;
    return {
      providerReference: `mock-pay-${input.escrowId}`,
      amount: input.amount,
      currency: input.currency,
      status: "PENDING",
      paymentUrl: `http://localhost:3000/pay/${input.escrowId}`,
    };
  }

  async verifyWebhook(input: { rawBody: string; signature: string }) {
    this.calls.verifyWebhook++;
    if (!input.signature) throw new Error("Missing mock webhook signature");
    return {
      eventId: `mock-event-${Date.now()}`,
      eventType: "payment.succeeded",
      payload: JSON.parse(input.rawBody),
    };
  }

  supportsRefund(paymentMethod?: string): boolean {
    if (!paymentMethod) return true;
    const normalized = paymentMethod.toUpperCase();
    return this.supportedMethods.has(normalized);
  }

  async refund(input: {
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
  }> {
    this.calls.refund.push(input);

    if (input.paymentMethod && !this.supportsRefund(input.paymentMethod)) {
      return {
        providerReference: `mock-ref-${input.escrowId}-unsupported`,
        status: "UNSUPPORTED",
        failureCode: "REFUND_NOT_SUPPORTED",
        failureReason: `Payment method ${input.paymentMethod} does not support API refunds`,
      };
    }

    const ref = `mock-ref-${input.escrowId}-${input.idempotencyKey}`;

    switch (this.refundMode) {
      case "SUCCESS":
        return {
          providerReference: ref,
          status: "COMPLETED",
        };
      case "PENDING":
        return {
          providerReference: ref,
          status: "PENDING",
        };
      case "FAILED":
        return {
          providerReference: ref,
          status: "FAILED",
          failureCode: "CARD_REFUND_DECLINED",
          failureReason: "Card issuer declined refund transaction",
        };
      case "TIMEOUT":
        return {
          providerReference: ref,
          status: "TIMEOUT",
          failureCode: "PROVIDER_TIMEOUT",
          failureReason: "Payment provider request timed out",
        };
      case "UNSUPPORTED":
        return {
          providerReference: ref,
          status: "UNSUPPORTED",
          failureCode: "METHOD_UNSUPPORTED",
          failureReason: "Payment method does not support automated refund",
        };
      case "DUPLICATE":
        return {
          providerReference: ref,
          status: "FAILED",
          failureCode: "DUPLICATE_REFUND_REQUEST",
          failureReason: "Provider rejected duplicate refund request",
        };
      default:
        return {
          providerReference: ref,
          status: "COMPLETED",
        };
    }
  }
}

export class MockFiduciaryProvider implements FiduciaryProvider {
  public releaseMode: MockFiduciaryMode = "SUCCESS";
  public refundMode: MockFiduciaryMode = "SUCCESS";
  private statusOverrides: Map<
    string,
    { status: FiduciaryStatus; amount?: string; currency?: string }
  > = new Map();

  public calls: {
    verifyIncomingFunds: Array<Record<string, unknown>>;
    requestRelease: Array<Record<string, unknown>>;
    requestRefund: Array<Record<string, unknown>>;
    getTransactionStatus: Array<Record<string, unknown>>;
  } = {
    verifyIncomingFunds: [],
    requestRelease: [],
    requestRefund: [],
    getTransactionStatus: [],
  };

  setStatusOverride(
    providerReference: string,
    status: FiduciaryStatus,
    amount?: string,
    currency?: string
  ) {
    this.statusOverrides.set(providerReference, { status, amount, currency });
  }

  async verifyIncomingFunds(input: { escrowId: string; expectedAmount: string; reference: string }) {
    this.calls.verifyIncomingFunds.push(input);
    return { confirmed: true, providerReference: `mock-funds-${input.escrowId}` };
  }

  async requestRelease(input: {
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
  }> {
    this.calls.requestRelease.push(input);
    const ref = `mock-fidu-rel-${input.escrowId}-${input.idempotencyKey}`;

    switch (this.releaseMode) {
      case "SUCCESS":
        this.setStatusOverride(ref, "COMPLETED", input.amount, input.currency ?? "USD");
        return { providerReference: ref, status: "COMPLETED" };
      case "PENDING":
        this.setStatusOverride(ref, "PENDING", input.amount, input.currency ?? "USD");
        return { providerReference: ref, status: "PENDING" };
      case "FAILED":
        this.setStatusOverride(ref, "FAILED", input.amount, input.currency ?? "USD");
        return {
          providerReference: ref,
          status: "FAILED",
          failureCode: "FIDUCIARY_PAYOUT_REJECTED",
          failureReason: "Target bank account invalid or unreachable",
        };
      case "TIMEOUT":
        this.setStatusOverride(ref, "UNKNOWN", input.amount, input.currency ?? "USD");
        return {
          providerReference: ref,
          status: "TIMEOUT",
          failureCode: "FIDUCIARY_TIMEOUT",
          failureReason: "Fiduciary connection timeout",
        };
      case "MISMATCH":
        this.setStatusOverride(ref, "MISMATCH", "999.99", input.currency ?? "USD");
        return {
          providerReference: ref,
          status: "MISMATCH",
          failureCode: "AMOUNT_MISMATCH",
          failureReason: "Provider amount mismatched",
        };
      case "UNKNOWN":
        this.setStatusOverride(ref, "UNKNOWN", input.amount, input.currency ?? "USD");
        return { providerReference: ref, status: "UNKNOWN" };
      default:
        this.setStatusOverride(ref, "COMPLETED", input.amount, input.currency ?? "USD");
        return { providerReference: ref, status: "COMPLETED" };
    }
  }

  async requestRefund(input: {
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
  }> {
    this.calls.requestRefund.push(input);
    const ref = `mock-fidu-ref-${input.escrowId}-${input.idempotencyKey}`;

    switch (this.refundMode) {
      case "SUCCESS":
        this.setStatusOverride(ref, "COMPLETED", input.amount, input.currency ?? "USD");
        return { providerReference: ref, status: "COMPLETED" };
      case "PENDING":
        this.setStatusOverride(ref, "PENDING", input.amount, input.currency ?? "USD");
        return { providerReference: ref, status: "PENDING" };
      case "FAILED":
        this.setStatusOverride(ref, "FAILED", input.amount, input.currency ?? "USD");
        return {
          providerReference: ref,
          status: "FAILED",
          failureCode: "FIDUCIARY_REFUND_REJECTED",
          failureReason: "Fiduciary rejected refund instruction",
        };
      case "TIMEOUT":
        this.setStatusOverride(ref, "UNKNOWN", input.amount, input.currency ?? "USD");
        return {
          providerReference: ref,
          status: "TIMEOUT",
          failureCode: "FIDUCIARY_TIMEOUT",
          failureReason: "Fiduciary connection timeout",
        };
      default:
        this.setStatusOverride(ref, "COMPLETED", input.amount, input.currency ?? "USD");
        return { providerReference: ref, status: "COMPLETED" };
    }
  }

  async getTransactionStatus(input: {
    providerReference: string;
    escrowId?: string;
  }): Promise<{
    status: FiduciaryStatus;
    providerReference: string;
    amount?: string;
    currency?: string;
  }> {
    this.calls.getTransactionStatus.push(input);

    const override = this.statusOverrides.get(input.providerReference);
    if (override) {
      return {
        status: override.status,
        providerReference: input.providerReference,
        amount: override.amount,
        currency: override.currency,
      };
    }

    return {
      status: "COMPLETED",
      providerReference: input.providerReference,
    };
  }
}
