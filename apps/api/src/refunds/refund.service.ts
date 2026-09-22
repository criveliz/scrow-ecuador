import {
  ActorRole,
  EscrowStatus,
} from "@escrow-ecuador/domain";
import {
  AuditLogRepository,
  DbClient,
  DisputeRepository,
  EscrowRepository,
  LedgerRepository,
  PaymentRepository,
  Refund,
  ReleaseRepository,
} from "@escrow-ecuador/database";
import { FiduciaryProvider, PaymentProvider } from "@escrow-ecuador/providers";
import { postConfirmedRefundLedger } from "../shared/ledger-helper.js";

function parseToCents(amountStr: string | number): bigint {
  const str = String(amountStr);
  const trimmed = str.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error(`Invalid monetary amount format: '${amountStr}'`);
  }
  const [dollars, cents = ""] = trimmed.split(".");
  const paddedCents = cents.padEnd(2, "0");
  return BigInt(dollars) * 100n + BigInt(paddedCents);
}

export interface RequestRefundInput {
  escrowId: string;
  paymentId?: string;
  actorId: string;
  actorRole: ActorRole;
  idempotencyKey: string;
  amount?: string;
  reason?: string;
  isDisputeOverride?: boolean;
}

export class RefundService {
  constructor(
    private readonly db: DbClient,
    private readonly escrowRepo: EscrowRepository,
    private readonly paymentRepo: PaymentRepository,
    private readonly releaseRepo: ReleaseRepository,
    private readonly disputeRepo: DisputeRepository,
    private readonly auditRepo: AuditLogRepository,
    private readonly ledgerRepo: LedgerRepository,
    private readonly paymentProvider: PaymentProvider,
    private readonly fiduciaryProvider: FiduciaryProvider
  ) {}

  async requestRefund(input: RequestRefundInput): Promise<{ refund: Refund; escrowStatus: EscrowStatus }> {
    const { escrowId, paymentId, actorId, actorRole, idempotencyKey, amount, reason, isDisputeOverride } = input;

    if (!idempotencyKey || idempotencyKey.trim() === "") {
      throw new Error("Idempotency key is required for refund operations");
    }

    // 1. Idempotency Check
    const existingByIdempotency = await this.releaseRepo.findRefundByIdempotencyKey(idempotencyKey);
    if (existingByIdempotency) {
      const currentEscrow = await this.escrowRepo.findById(escrowId);
      return { refund: existingByIdempotency, escrowStatus: currentEscrow?.status ?? EscrowStatus.REFUNDED };
    }

    // 2. Load Escrow Transaction
    const escrow = await this.escrowRepo.findById(escrowId);
    if (!escrow) {
      throw new Error(`Escrow transaction ${escrowId} not found`);
    }

    // 3. Dispute Check
    const disputes = await this.disputeRepo.findByEscrowId(escrowId);
    const activeDispute = disputes.find((d) => d.status === "OPEN" || d.status === "DISPUTED");
    const isPrivileged = [
      "ADMIN",
      "SUPER_ADMIN",
      "SUPPORT",
      "SYSTEM",
    ].includes(actorRole as string);

    if (activeDispute && !isDisputeOverride && !isPrivileged) {
      throw new Error(`Cannot refund funds: escrow ${escrowId} has an active open dispute`);
    }

    // 4. Authorization & IDOR Check
    const isBuyer = escrow.buyer_id === actorId;
    const isSeller = escrow.seller_id === actorId;

    if (!isBuyer && !isSeller && !isPrivileged) {
      throw new Error(`IDOR_VIOLATION: Actor ${actorId} is not authorized for escrow ${escrowId}`);
    }

    if (!isPrivileged) {
      if (actorRole === ActorRole.SELLER) {
        throw new Error("SELLER cannot arbitrarily refund escrow funds");
      }
      if (actorRole === ActorRole.BUYER && escrow.status !== EscrowStatus.AWAITING_PAYMENT && escrow.status !== EscrowStatus.CANCELLED) {
        throw new Error(`BUYER cannot initiate refund when escrow status is ${escrow.status}`);
      }
    }

    // 5. Payment Verification & Status Validation
    const payments = await this.paymentRepo.findByEscrowId(escrowId);
    if (payments.length === 0) {
      throw new Error(`Cannot refund escrow ${escrowId}: no payment records found`);
    }

    const confirmedStatuses = ["PAID", "COMPLETED", "SUCCESS", "FUNDS_CONFIRMED"];
    const targetPayment = paymentId
      ? payments.find((p) => p.id === paymentId)
      : payments.find((p) => confirmedStatuses.includes(p.status.toUpperCase()));

    if (!targetPayment || !confirmedStatuses.includes(targetPayment.status.toUpperCase())) {
      throw new Error(`No valid confirmed payment found for refund on escrow ${escrowId}`);
    }

    // 6. Refund Amount Control (Exact BigInt Cents Arithmetic)
    const paymentCents = parseToCents(targetPayment.amount);
    const existingRefunds = await this.releaseRepo.findRefundsByEscrowId(escrowId);

    let previousRefundCents = 0n;
    for (const ref of existingRefunds) {
      if (ref.status === "COMPLETED" || ref.status === "PENDING") {
        previousRefundCents += parseToCents(ref.amount);
      }
    }

    const requestedCents = amount ? parseToCents(amount) : parseToCents(escrow.amount);
    if (requestedCents <= 0n) {
      throw new Error("Refund amount must be positive");
    }

    const remainingRefundableCents = paymentCents - previousRefundCents;
    if (requestedCents > remainingRefundableCents) {
      const requestedStr = (Number(requestedCents) / 100).toFixed(2);
      const remainingStr = (Number(remainingRefundableCents) / 100).toFixed(2);
      throw new Error(
        `REFUND_AMOUNT_EXCEEDED: Requested refund (${requestedStr}) exceeds remaining refundable balance (${remainingStr})`
      );
    }

    const formattedRefundAmount = (Number(requestedCents) / 100).toFixed(2);

    // 7. Check Provider Capabilities
    const methodSupported = this.paymentProvider.supportsRefund(targetPayment.provider);

    if (!methodSupported) {
      let manualRefundRecord: Refund;
      try {
        manualRefundRecord = await this.releaseRepo.createRefund({
          escrow_id: escrow.id,
          amount: formattedRefundAmount,
          currency: escrow.currency,
          status: "REQUIRES_MANUAL_PROCESS",
          provider: targetPayment.provider,
          idempotency_key: idempotencyKey,
          failure_code: "REFUND_REQUIRES_MANUAL_PROCESS",
          failure_reason: `Payment method ${targetPayment.provider} does not support automated API refunds. Manual bank transfer required.`,
          requested_at: new Date(),
        });
      } catch {
        const existing = await this.releaseRepo.findRefundByIdempotencyKey(idempotencyKey);
        if (existing) return { refund: existing, escrowStatus: escrow.status };
        throw new Error("Failed to create manual refund record");
      }

      await this.auditRepo.create({
        actor_id: actorId,
        action: "REFUND_REQUIRES_MANUAL_PROCESS",
        entity_type: "REFUND",
        entity_id: manualRefundRecord.id,
        previous_state: null,
        new_state: "REQUIRES_MANUAL_PROCESS",
        metadata: {
          escrow_id: escrow.id,
          provider: targetPayment.provider,
          amount: formattedRefundAmount,
          reason: "Payment method does not support API refund",
        },
      });

      return { refund: manualRefundRecord, escrowStatus: escrow.status };
    }

    // 8. Create Initial Refund Record
    let refundRecord: Refund;
    try {
      refundRecord = await this.releaseRepo.createRefund({
        escrow_id: escrow.id,
        amount: formattedRefundAmount,
        currency: escrow.currency,
        status: "PENDING",
        provider: targetPayment.provider,
        idempotency_key: idempotencyKey,
        requested_at: new Date(),
      });
    } catch {
      const existing = await this.releaseRepo.findRefundByIdempotencyKey(idempotencyKey);
      if (existing) return { refund: existing, escrowStatus: escrow.status };
      throw new Error("Failed to create refund record");
    }

    await this.auditRepo.create({
      actor_id: actorId,
      action: "REFUND_REQUESTED",
      entity_type: "REFUND",
      entity_id: refundRecord.id,
      previous_state: null,
      new_state: "PENDING",
      metadata: { escrow_id: escrow.id, amount: formattedRefundAmount, idempotency_key: idempotencyKey },
    });

    // 9. Call Payment Provider Refund
    const providerResult = await this.paymentProvider.refund({
      paymentId: targetPayment.id,
      escrowId: escrow.id,
      amount: formattedRefundAmount,
      currency: escrow.currency,
      idempotencyKey,
      reason: reason ?? "Escrow refund requested",
      paymentMethod: targetPayment.provider,
    });

    // 10. Process Provider Response
    if (providerResult.status === "COMPLETED") {
      let newEscrowStatus: EscrowStatus = escrow.status;
      if (escrow.status !== EscrowStatus.REFUNDED) {
        let currentStatus: EscrowStatus = escrow.status;
        if (currentStatus !== EscrowStatus.DISPUTED && currentStatus !== EscrowStatus.AWAITING_PAYMENT) {
          const disputeTransition = await this.escrowRepo.transitionStatus({
            transactionId: escrow.id,
            previousState: currentStatus,
            newState: EscrowStatus.DISPUTED,
            actorId,
            actorRole: isPrivileged ? actorRole : ActorRole.SYSTEM,
            timestamp: new Date(),
            reason: "Escrow dispute recorded prior to administrative refund",
          });
          currentStatus = disputeTransition.status as EscrowStatus;
        }

        const refundedTransition = await this.escrowRepo.transitionStatus({
          transactionId: escrow.id,
          previousState: currentStatus,
          newState: EscrowStatus.REFUNDED,
          actorId,
          actorRole: isPrivileged ? actorRole : ActorRole.SYSTEM,
          timestamp: new Date(),
          reason: reason ?? "Payment refund confirmed by payment provider",
        });
        newEscrowStatus = refundedTransition.status as EscrowStatus;
      }

      await postConfirmedRefundLedger({
        ledgerRepo: this.ledgerRepo,
        escrowId: escrow.id,
        amount: formattedRefundAmount,
        currency: escrow.currency,
        providerReference: providerResult.providerReference,
      });

      const updatedRefund = await this.releaseRepo.updateRefundStatus(refundRecord.id, "COMPLETED", {
        providerRefundId: providerResult.providerReference,
        completedAt: new Date(),
      });

      await this.auditRepo.create({
        actor_id: actorId,
        action: "REFUND_COMPLETED",
        entity_type: "REFUND",
        entity_id: refundRecord.id,
        previous_state: "PENDING",
        new_state: "COMPLETED",
        metadata: { provider_refund_id: providerResult.providerReference },
      });

      return { refund: updatedRefund, escrowStatus: newEscrowStatus };
    } else if (providerResult.status === "UNSUPPORTED") {
      const updatedRefund = await this.releaseRepo.updateRefundStatus(refundRecord.id, "REQUIRES_MANUAL_PROCESS", {
        providerRefundId: providerResult.providerReference,
        failureCode: providerResult.failureCode ?? "REFUND_REQUIRES_MANUAL_PROCESS",
        failureReason: providerResult.failureReason ?? "Payment method does not support automated API refund",
      });

      await this.auditRepo.create({
        actor_id: actorId,
        action: "REFUND_MANUAL_PROCESS_REQUIRED",
        entity_type: "REFUND",
        entity_id: refundRecord.id,
        previous_state: "PENDING",
        new_state: "REQUIRES_MANUAL_PROCESS",
        metadata: { failure_code: providerResult.failureCode },
      });

      return { refund: updatedRefund, escrowStatus: escrow.status };
    } else if (providerResult.status === "FAILED") {
      const updatedRefund = await this.releaseRepo.updateRefundStatus(refundRecord.id, "FAILED", {
        providerRefundId: providerResult.providerReference,
        failureCode: providerResult.failureCode ?? "REFUND_FAILED",
        failureReason: providerResult.failureReason ?? "Provider refund failed",
      });

      await this.auditRepo.create({
        actor_id: actorId,
        action: "REFUND_FAILED",
        entity_type: "REFUND",
        entity_id: refundRecord.id,
        previous_state: "PENDING",
        new_state: "FAILED",
        metadata: { failure_code: providerResult.failureCode, failure_reason: providerResult.failureReason },
      });

      return { refund: updatedRefund, escrowStatus: escrow.status };
    } else if (providerResult.status === "TIMEOUT") {
      const updatedRefund = await this.releaseRepo.updateRefundStatus(refundRecord.id, "REVIEW_REQUIRED", {
        providerRefundId: providerResult.providerReference,
        failureCode: "TIMEOUT_UNCERTAIN",
        failureReason: "Payment provider refund timed out; status uncertain. Do not retry blindly.",
      });

      await this.auditRepo.create({
        actor_id: actorId,
        action: "REFUND_TIMEOUT_REVIEW_REQUIRED",
        entity_type: "REFUND",
        entity_id: refundRecord.id,
        previous_state: "PENDING",
        new_state: "REVIEW_REQUIRED",
        metadata: { provider_refund_id: providerResult.providerReference },
      });

      return { refund: updatedRefund, escrowStatus: escrow.status };
    } else {
      const updatedRefund = await this.releaseRepo.updateRefundStatus(refundRecord.id, "PENDING", {
        providerRefundId: providerResult.providerReference,
      });

      return { refund: updatedRefund, escrowStatus: escrow.status };
    }
  }

  async getRefund(refundId: string, actorId: string, actorRole: ActorRole): Promise<Refund> {
    const refund = await this.releaseRepo.findRefundById(refundId);
    if (!refund) {
      throw new Error(`Refund record ${refundId} not found`);
    }

    const escrow = await this.escrowRepo.findById(refund.escrow_id);
    if (!escrow) {
      throw new Error(`Escrow transaction ${refund.escrow_id} not found`);
    }

    const isBuyer = escrow.buyer_id === actorId;
    const isSeller = escrow.seller_id === actorId;
    const isPrivileged = [
      "ADMIN",
      "SUPER_ADMIN",
      "SUPPORT",
      "SYSTEM",
    ].includes(actorRole as string);

    if (!isBuyer && !isSeller && !isPrivileged) {
      throw new Error(`IDOR_VIOLATION: Actor ${actorId} is not authorized to view refund ${refundId}`);
    }

    return refund;
  }
}
