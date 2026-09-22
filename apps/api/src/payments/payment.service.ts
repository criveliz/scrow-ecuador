import crypto from "crypto";
import { EscrowStatus } from "@escrow-ecuador/domain";
import {
  AuditLogRepository,
  EscrowRepository,
  EscrowTransaction,
  IdempotencyRepository,
  Payment,
  PaymentRepository,
} from "@escrow-ecuador/database";
import { PaymentProvider } from "@escrow-ecuador/providers";
import { TokenPayload } from "../auth/jwt.js";
import { isPrivilegedRole } from "../auth/rbac.js";

export class PaymentServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string
  ) {
    super(message);
    this.name = "PaymentServiceError";
  }
}

export class PaymentService {
  constructor(
    private readonly paymentRepo: PaymentRepository,
    private readonly escrowRepo: EscrowRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly idempotencyRepo: IdempotencyRepository,
    private readonly paymentProvider: PaymentProvider,
    private readonly providerName: string = "KUSHKI"
  ) {}

  private computeHash(payload: unknown): string {
    return crypto.createHash("sha256").update(JSON.stringify(payload ?? {})).digest("hex");
  }

  private verifyOwnership(escrow: EscrowTransaction, user: TokenPayload): void {
    if (isPrivilegedRole(user.role)) {
      return;
    }
    if (escrow.buyer_id !== user.userId && escrow.seller_id !== user.userId) {
      throw new PaymentServiceError(
        403,
        "FORBIDDEN",
        "You do not have permission to initiate or view payments for this escrow operation"
      );
    }
  }

  async initiatePayment(
    user: TokenPayload,
    escrowId: string,
    body: Record<string, any>,
    idempotencyKey?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const escrow = await this.escrowRepo.findById(escrowId);
    if (!escrow) {
      throw new PaymentServiceError(404, "NOT_FOUND", `Escrow operation with ID ${escrowId} not found`);
    }

    this.verifyOwnership(escrow, user);

    const allowedStatuses: EscrowStatus[] = [EscrowStatus.CREATED, EscrowStatus.AWAITING_PAYMENT];
    if (!allowedStatuses.includes(escrow.status)) {
      throw new PaymentServiceError(
        400,
        "BAD_REQUEST",
        `Cannot initiate payment for escrow in '${escrow.status}' status`
      );
    }

    const scope = `initiate_payment:${escrowId}:${user.userId}`;
    const requestHash = this.computeHash(body);

    if (idempotencyKey) {
      const existingKey = await this.idempotencyRepo.findByKeyAndScope(idempotencyKey, scope);
      if (existingKey) {
        if (existingKey.request_hash && existingKey.request_hash !== requestHash) {
          throw new PaymentServiceError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key provided with different payload"
          );
        }
        return {
          status: existingKey.response_status ?? 200,
          body: (existingKey.response_body as Record<string, unknown>) ?? {},
        };
      }
    }

    // Derive amount and currency strictly from Escrow DB record! Never trust client body for amount.
    const amountNum = parseFloat(escrow.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new PaymentServiceError(400, "BAD_REQUEST", "Escrow amount must be positive");
    }
    const formattedAmount = amountNum.toFixed(2);
    const currency = escrow.currency === "USD" ? "USD" : "USD";

    let paymentIntent;
    try {
      paymentIntent = await this.paymentProvider.createPaymentIntent({
        escrowId,
        amount: formattedAmount,
        currency,
        idempotencyKey: idempotencyKey || `pay-${escrowId}-${Date.now()}`,
        token: body.token || body.paymentToken,
        metadata: {
          buyerId: escrow.buyer_id,
          sellerId: escrow.seller_id,
        },
      });
    } catch (err: any) {
      throw new PaymentServiceError(
        502,
        "PAYMENT_PROVIDER_ERROR",
        err.message || "Failed to communicate with payment gateway"
      );
    }

    const payment = await this.paymentRepo.create({
      escrow_id: escrow.id,
      provider: this.providerName,
      provider_payment_id: paymentIntent.providerReference,
      provider_reference: paymentIntent.providerReference,
      amount: formattedAmount,
      currency,
      status: paymentIntent.status,
    });

    await this.auditLogRepo.create({
      actor_id: user.userId,
      action: "PAYMENT_INITIATED",
      entity_type: "payment",
      entity_id: payment.id,
      previous_state: null,
      new_state: payment.status,
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
      metadata: {
        escrow_id: escrow.id,
        amount: formattedAmount,
        currency,
        provider: this.providerName,
        providerReference: paymentIntent.providerReference,
      },
    });

    const responsePayload = {
      payment,
      checkoutData: paymentIntent.checkoutData || {
        paymentUrl: paymentIntent.paymentUrl,
        providerReference: paymentIntent.providerReference,
      },
      disclaimer: "Payment initiation does not constitute final confirmation of funds.",
    };

    if (idempotencyKey) {
      await this.idempotencyRepo.saveKey({
        key: idempotencyKey,
        scope,
        requestHash,
        responseStatus: 200,
        responseBody: responsePayload,
      });
    }

    return { status: 200, body: responsePayload };
  }

  async getPaymentById(user: TokenPayload, paymentId: string): Promise<Payment> {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) {
      throw new PaymentServiceError(404, "NOT_FOUND", `Payment record with ID ${paymentId} not found`);
    }

    const escrow = await this.escrowRepo.findById(payment.escrow_id);
    if (!escrow) {
      throw new PaymentServiceError(404, "NOT_FOUND", `Associated escrow not found`);
    }

    this.verifyOwnership(escrow, user);
    return payment;
  }
}
