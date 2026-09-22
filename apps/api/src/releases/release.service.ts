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
  Release,
  ReleaseRepository,
} from "@escrow-ecuador/database";
import { FiduciaryProvider } from "@escrow-ecuador/providers";
import { postConfirmedReleaseLedger } from "../shared/ledger-helper.js";

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

export interface RequestReleaseInput {
  escrowId: string;
  actorId: string;
  actorRole: ActorRole;
  idempotencyKey: string;
  requestedAmount?: string;
  recipientReference?: string;
  isDisputeOverride?: boolean;
}

export class ReleaseService {
  constructor(
    private readonly db: DbClient,
    private readonly escrowRepo: EscrowRepository,
    private readonly paymentRepo: PaymentRepository,
    private readonly releaseRepo: ReleaseRepository,
    private readonly disputeRepo: DisputeRepository,
    private readonly auditRepo: AuditLogRepository,
    private readonly ledgerRepo: LedgerRepository,
    private readonly fiduciaryProvider: FiduciaryProvider
  ) {}

  async requestRelease(input: RequestReleaseInput): Promise<{ release: Release; escrowStatus: EscrowStatus }> {
    const { escrowId, actorId, actorRole, idempotencyKey, requestedAmount, isDisputeOverride } = input;

    if (!idempotencyKey || idempotencyKey.trim() === "") {
      throw new Error("Idempotency key is required for release operations");
    }

    // 1. Idempotency Check
    const existingByIdempotency = await this.releaseRepo.findByIdempotencyKey(idempotencyKey);
    if (existingByIdempotency) {
      const currentEscrow = await this.escrowRepo.findById(escrowId);
      return { release: existingByIdempotency, escrowStatus: currentEscrow?.status ?? EscrowStatus.RELEASED };
    }

    // 2. Load Escrow Transaction
    const escrow = await this.escrowRepo.findById(escrowId);
    if (!escrow) {
      throw new Error(`Escrow transaction ${escrowId} not found`);
    }

    // 3. Duplicate Release Check
    if (escrow.status === EscrowStatus.RELEASED) {
      throw new Error(`Release already completed for escrow ${escrowId}`);
    }

    const existingReleases = await this.releaseRepo.findByEscrowId(escrowId);
    const completedRelease = existingReleases.find((r) => r.status === "COMPLETED" || r.status === "SUCCESS");
    if (completedRelease) {
      throw new Error(`Release already completed for escrow ${escrowId}`);
    }

    // 4. IDOR and Authorization Check
    const isBuyer = escrow.buyer_id === actorId;
    const isSeller = escrow.seller_id === actorId;
    const isPrivileged = [
      "ADMIN",
      "SUPER_ADMIN",
      "SUPPORT",
      "SYSTEM",
    ].includes(actorRole as string);

    if (!isBuyer && !isSeller && !isPrivileged) {
      throw new Error(`IDOR_VIOLATION: Actor ${actorId} is not authorized for escrow ${escrowId}`);
    }

    if (!isPrivileged) {
      if (actorRole === ActorRole.SELLER) {
        throw new Error("SELLER cannot arbitrarily initiate fund release to self");
      }
      if (actorRole === ActorRole.BUYER && escrow.status !== EscrowStatus.BUYER_CONFIRMED && escrow.status !== EscrowStatus.DELIVERED) {
        throw new Error(`BUYER cannot request release when escrow status is ${escrow.status}`);
      }
    }

    // 5. Amount and Currency Validation (Exact BigInt Cents Logic)
    if (requestedAmount !== undefined) {
      const requestedCents = parseToCents(requestedAmount);
      const escrowCents = parseToCents(escrow.amount);
      if (requestedCents !== escrowCents) {
        throw new Error(`Release amount mismatch: requested ${requestedAmount}, escrow amount is ${escrow.amount}`);
      }
    }

    // 6. Payment Confirmation Validation
    const payments = await this.paymentRepo.findByEscrowId(escrowId);
    const confirmedPayment = payments.find(
      (p) => ["PAID", "COMPLETED", "SUCCESS", "FUNDS_CONFIRMED"].includes(p.status.toUpperCase())
    );
    if (!confirmedPayment) {
      throw new Error(`Cannot release escrow ${escrowId}: no confirmed payment found`);
    }

    // 7. Dispute Check
    const disputes = await this.disputeRepo.findByEscrowId(escrowId);
    const activeDispute = disputes.find((d) => d.status === "OPEN" || d.status === "DISPUTED");
    if (activeDispute && !isDisputeOverride) {
      throw new Error(`Cannot release funds: escrow ${escrowId} has an active open dispute`);
    }

    // 8. Atomically Record Initial Release Record in DB (Status: PENDING)
    let releaseRecord: Release;
    try {
      releaseRecord = await this.releaseRepo.createRelease({
        escrow_id: escrow.id,
        amount: escrow.amount,
        currency: escrow.currency,
        status: "PENDING",
        provider: "FIDUCIARY",
        idempotency_key: idempotencyKey,
        requested_at: new Date(),
      });
    } catch {
      const existing = await this.releaseRepo.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        const reloadedEscrow = await this.escrowRepo.findById(escrowId);
        return { release: existing, escrowStatus: reloadedEscrow?.status ?? EscrowStatus.RELEASED };
      }
      throw new Error("Failed to create release record");
    }

    await this.auditRepo.create({
      actor_id: actorId,
      action: "RELEASE_REQUESTED",
      entity_type: "RELEASE",
      entity_id: releaseRecord.id,
      previous_state: null,
      new_state: "PENDING",
      metadata: { escrow_id: escrow.id, amount: escrow.amount, idempotency_key: idempotencyKey },
    });

    // 9. Execute Domain State Transition to RELEASE_PENDING (if not already RELEASE_PENDING or RELEASED)
    let currentStatus: EscrowStatus = escrow.status;
    if (currentStatus !== EscrowStatus.RELEASE_PENDING && (currentStatus as EscrowStatus) !== EscrowStatus.RELEASED) {
      try {
        if (currentStatus === EscrowStatus.DELIVERED && isBuyer) {
          const deliveredTransition = await this.escrowRepo.transitionStatus({
            transactionId: escrow.id,
            previousState: EscrowStatus.DELIVERED,
            newState: EscrowStatus.BUYER_CONFIRMED,
            actorId,
            actorRole,
            timestamp: new Date(),
            reason: "Buyer confirmed delivery prior to release",
          });
          currentStatus = deliveredTransition.status as EscrowStatus;
        }

        const releasePendingTransition = await this.escrowRepo.transitionStatus({
          transactionId: escrow.id,
          previousState: currentStatus,
          newState: EscrowStatus.RELEASE_PENDING,
          actorId,
          actorRole,
          timestamp: new Date(),
          reason: isDisputeOverride ? "Admin dispute override fund release" : "Fulfillment confirmed, release initiated",
        });
        currentStatus = releasePendingTransition.status as EscrowStatus;

        await this.auditRepo.create({
          actor_id: actorId,
          action: "ESCROW_STATE_TRANSITION",
          entity_type: "ESCROW",
          entity_id: escrow.id,
          previous_state: escrow.status,
          new_state: currentStatus,
          metadata: { reason: "Transitioned to RELEASE_PENDING" },
        });
      } catch {
        const reloadedEscrow = await this.escrowRepo.findById(escrowId);
        currentStatus = (reloadedEscrow?.status ?? EscrowStatus.RELEASE_PENDING) as EscrowStatus;
      }
    }

    // 10. Call Fiduciary Provider Adapter
    const providerResult = await this.fiduciaryProvider.requestRelease({
      escrowId: escrow.id,
      amount: escrow.amount,
      currency: escrow.currency,
      idempotencyKey,
      recipientReference: input.recipientReference,
    });

    // 11. Process Fiduciary Response
    if (providerResult.status === "COMPLETED") {
      let releasedStatus: EscrowStatus = currentStatus;
      if ((currentStatus as EscrowStatus) !== EscrowStatus.RELEASED) {
        const releasedTransition = await this.escrowRepo.transitionStatus({
          transactionId: escrow.id,
          previousState: currentStatus,
          newState: EscrowStatus.RELEASED,
          actorId,
          actorRole: isPrivileged ? actorRole : ActorRole.SYSTEM,
          timestamp: new Date(),
          reason: "Fiduciary provider confirmed successful payout",
        });
        releasedStatus = releasedTransition.status as EscrowStatus;
      }

      await postConfirmedReleaseLedger({
        ledgerRepo: this.ledgerRepo,
        escrowId: escrow.id,
        amount: escrow.amount,
        currency: escrow.currency,
        providerReference: providerResult.providerReference,
      });

      const updatedRelease = await this.releaseRepo.updateReleaseStatus(releaseRecord.id, "COMPLETED", {
        providerReleaseId: providerResult.providerReference,
        completedAt: new Date(),
      });

      await this.auditRepo.create({
        actor_id: actorId,
        action: "RELEASE_COMPLETED",
        entity_type: "RELEASE",
        entity_id: releaseRecord.id,
        previous_state: "PENDING",
        new_state: "COMPLETED",
        metadata: { provider_release_id: providerResult.providerReference },
      });

      return { release: updatedRelease, escrowStatus: releasedStatus };
    } else if (providerResult.status === "FAILED") {
      const updatedRelease = await this.releaseRepo.updateReleaseStatus(releaseRecord.id, "FAILED", {
        providerReleaseId: providerResult.providerReference,
        failureCode: providerResult.failureCode ?? "FIDUCIARY_FAILED",
        failureReason: providerResult.failureReason ?? "Fiduciary release request failed",
      });

      await this.auditRepo.create({
        actor_id: actorId,
        action: "RELEASE_FAILED",
        entity_type: "RELEASE",
        entity_id: releaseRecord.id,
        previous_state: "PENDING",
        new_state: "FAILED",
        metadata: { failure_code: providerResult.failureCode, failure_reason: providerResult.failureReason },
      });

      return { release: updatedRelease, escrowStatus: currentStatus };
    } else if (providerResult.status === "MISMATCH") {
      const updatedRelease = await this.releaseRepo.updateReleaseStatus(releaseRecord.id, "MISMATCH", {
        providerReleaseId: providerResult.providerReference,
        failureCode: providerResult.failureCode ?? "AMOUNT_MISMATCH",
        failureReason: providerResult.failureReason ?? "Fiduciary reported amount mismatch",
      });

      await this.auditRepo.create({
        actor_id: actorId,
        action: "RELEASE_MISMATCH",
        entity_type: "RELEASE",
        entity_id: releaseRecord.id,
        previous_state: "PENDING",
        new_state: "MISMATCH",
        metadata: { provider_release_id: providerResult.providerReference },
      });

      return { release: updatedRelease, escrowStatus: currentStatus };
    } else if (providerResult.status === "TIMEOUT" || providerResult.status === "UNKNOWN") {
      const updatedRelease = await this.releaseRepo.updateReleaseStatus(releaseRecord.id, "REVIEW_REQUIRED", {
        providerReleaseId: providerResult.providerReference,
        failureCode: "TIMEOUT_UNCERTAIN",
        failureReason: "Fiduciary response timed out; status uncertain. Do not retry blindly.",
      });

      await this.auditRepo.create({
        actor_id: actorId,
        action: "RELEASE_TIMEOUT_REVIEW_REQUIRED",
        entity_type: "RELEASE",
        entity_id: releaseRecord.id,
        previous_state: "PENDING",
        new_state: "REVIEW_REQUIRED",
        metadata: { provider_release_id: providerResult.providerReference },
      });

      return { release: updatedRelease, escrowStatus: currentStatus };
    } else {
      const updatedRelease = await this.releaseRepo.updateReleaseStatus(releaseRecord.id, "PENDING", {
        providerReleaseId: providerResult.providerReference,
      });

      return { release: updatedRelease, escrowStatus: currentStatus };
    }
  }

  async getRelease(releaseId: string, actorId: string, actorRole: ActorRole): Promise<Release> {
    const release = await this.releaseRepo.findById(releaseId);
    if (!release) {
      throw new Error(`Release record ${releaseId} not found`);
    }

    const escrow = await this.escrowRepo.findById(release.escrow_id);
    if (!escrow) {
      throw new Error(`Escrow transaction ${release.escrow_id} not found`);
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
      throw new Error(`IDOR_VIOLATION: Actor ${actorId} is not authorized to view release ${releaseId}`);
    }

    return release;
  }

  async retryRelease(releaseId: string, actorId: string, actorRole: ActorRole): Promise<Release> {
    const isPrivileged = ["ADMIN", "SUPER_ADMIN", "SYSTEM"].includes(actorRole as string);
    if (!isPrivileged) {
      throw new Error(`FORBIDDEN_ROLE: Role ${actorRole} is not authorized to retry releases`);
    }

    const release = await this.releaseRepo.findById(releaseId);
    if (!release) {
      throw new Error(`Release record ${releaseId} not found`);
    }

    if (release.status === "COMPLETED") {
      throw new Error(`Cannot retry release ${releaseId}: release is already COMPLETED`);
    }

    // Query provider status FIRST to avoid blind retry
    if (release.provider_release_id) {
      const providerStatus = await this.fiduciaryProvider.getTransactionStatus({
        providerReference: release.provider_release_id,
        escrowId: release.escrow_id,
      });

      if (providerStatus.status === "COMPLETED") {
        const escrow = await this.escrowRepo.findById(release.escrow_id);
        if (escrow && escrow.status !== EscrowStatus.RELEASED) {
          await this.escrowRepo.transitionStatus({
            transactionId: escrow.id,
            previousState: escrow.status,
            newState: EscrowStatus.RELEASED,
            actorId,
            actorRole,
            timestamp: new Date(),
            reason: "Reconciled completed release during retry inspection",
          });
        }

        await postConfirmedReleaseLedger({
          ledgerRepo: this.ledgerRepo,
          escrowId: release.escrow_id,
          amount: release.amount,
          currency: release.currency,
          providerReference: release.provider_release_id,
        });

        const updated = await this.releaseRepo.updateReleaseStatus(release.id, "COMPLETED", {
          completedAt: new Date(),
        });

        await this.auditRepo.create({
          actor_id: actorId,
          action: "RELEASE_RECONCILED_ON_RETRY",
          entity_type: "RELEASE",
          entity_id: release.id,
          previous_state: release.status,
          new_state: "COMPLETED",
          metadata: { provider_release_id: release.provider_release_id },
        });

        return updated;
      }
    }

    const newAttemptKey = `${release.idempotency_key ?? release.id}-retry-${Date.now()}`;
    const result = await this.requestRelease({
      escrowId: release.escrow_id,
      actorId,
      actorRole,
      idempotencyKey: newAttemptKey,
      isDisputeOverride: true,
    });

    await this.auditRepo.create({
      actor_id: actorId,
      action: "RELEASE_RETRIED",
      entity_type: "RELEASE",
      entity_id: release.id,
      previous_state: release.status,
      new_state: result.release.status,
      metadata: { retry_release_id: result.release.id },
    });

    return result.release;
  }
}
