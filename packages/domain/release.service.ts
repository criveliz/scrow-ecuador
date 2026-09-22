import { ActorRole, EscrowStatus } from "./state-machine.js";
import { FinancialFreezeError } from "./financial-freeze.js";
import type { AuditLogRepository } from "../database/repositories/audit-log.repository.js";
import type { DisputeRepository } from "../database/repositories/dispute.repository.js";
import type { EscrowRepository } from "../database/repositories/escrow.repository.js";
import type { LedgerRepository } from "../database/repositories/ledger.repository.js";
import type { ReleaseRepository } from "../database/repositories/release.repository.js";
import type { LedgerAccount, Release } from "../database/types/index.js";
import type { FiduciaryProvider } from "../providers/interfaces.js";

export interface ReleaseInput {
  escrowId: string;
  requestedBy: string;
  actorRole: ActorRole | string;
  idempotencyKey: string;
  isDisputeResolution?: boolean;
  ipAddress?: string;
  userAgent?: string;
}

export class ReleaseService {
  constructor(
    private readonly escrowRepo: EscrowRepository,
    private readonly releaseRepo: ReleaseRepository,
    private readonly disputeRepo: DisputeRepository,
    private readonly ledgerRepo: LedgerRepository,
    private readonly auditRepo: AuditLogRepository,
    private readonly fiduciaryProvider: FiduciaryProvider
  ) {}

  async requestRelease(input: ReleaseInput): Promise<Release> {
    const escrow = await this.escrowRepo.findById(input.escrowId);
    if (!escrow) {
      throw new Error(`Escrow ${input.escrowId} not found`);
    }

    // Check for existing release on this escrow
    const existingReleases = await this.releaseRepo.findByEscrowId(input.escrowId);
    const existingCompleted = existingReleases.find((r) => r.status === "COMPLETED" || r.status === "SUCCESS");
    if (existingCompleted) {
      return existingCompleted;
    }
    if (escrow.status === EscrowStatus.RELEASED && existingReleases.length > 0) {
      return existingReleases[0];
    }

    // 1. Financial Freeze Check
    const activeDispute = await this.disputeRepo.findActiveByEscrowId(input.escrowId);
    if ((activeDispute || escrow.status === EscrowStatus.DISPUTED) && !input.isDisputeResolution) {
      await this.auditRepo.create({
        actor_id: input.requestedBy,
        action: "RELEASE_BLOCKED_FINANCIAL_FREEZE",
        entity_type: "ESCROW",
        entity_id: input.escrowId,
        previous_state: escrow.status,
        new_state: escrow.status,
        ip_address: input.ipAddress ?? null,
        user_agent: input.userAgent ?? null,
        metadata: {
          dispute_id: activeDispute?.id ?? null,
          reason: "Active dispute financial freeze in effect",
        },
      });

      throw new FinancialFreezeError("Cannot release funds: Escrow transaction is frozen due to an active dispute.");
    }

    // State transition
    let currentState = escrow.status;
    if (currentState !== EscrowStatus.RELEASE_PENDING && currentState !== EscrowStatus.RELEASED) {
      const transitionResult = await this.escrowRepo.transitionStatus({
        transactionId: escrow.id,
        previousState: currentState,
        newState: EscrowStatus.RELEASE_PENDING,
        actorId: input.requestedBy,
        actorRole: input.actorRole as ActorRole,
        timestamp: new Date().toISOString(),
        reason: input.isDisputeResolution ? "Release triggered by dispute resolution" : "Release requested",
      });
      currentState = transitionResult.status;
    }

    // Fiduciary provider call
    const fiduciaryRes = await this.fiduciaryProvider.requestRelease({
      escrowId: escrow.id,
      amount: escrow.amount,
      idempotencyKey: input.idempotencyKey,
    });

    const releaseRecord = await this.releaseRepo.createRelease({
      escrow_id: escrow.id,
      amount: escrow.amount,
      currency: escrow.currency,
      status: fiduciaryRes.status === "COMPLETED" ? "COMPLETED" : "PENDING",
      provider: "FIDUCIARY_MOCK",
      provider_release_id: fiduciaryRes.providerReference,
    });

    // Complete state transition to RELEASED if completed
    if (releaseRecord.status === "COMPLETED") {
      await this.escrowRepo.transitionStatus({
        transactionId: escrow.id,
        previousState: EscrowStatus.RELEASE_PENDING,
        newState: EscrowStatus.RELEASED,
        actorId: input.requestedBy,
        actorRole: ActorRole.SYSTEM,
        timestamp: new Date().toISOString(),
        reason: "Fiduciary release completed",
      });

      // Post Double-Entry Ledger Entry
      await this.postReleaseLedger(escrow.id, escrow.amount, releaseRecord.id);
    }

    await this.auditRepo.create({
      actor_id: input.requestedBy,
      action: "FUNDS_RELEASED",
      entity_type: "RELEASE",
      entity_id: releaseRecord.id,
      previous_state: currentState,
      new_state: releaseRecord.status,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      metadata: {
        escrow_id: escrow.id,
        amount: escrow.amount,
        is_dispute_resolution: input.isDisputeResolution ?? false,
      },
    });

    return releaseRecord;
  }

  private async postReleaseLedger(escrowId: string, amount: string, releaseId: string): Promise<void> {
    let holdingAccount: LedgerAccount;
    let payoutAccount: LedgerAccount;

    try {
      holdingAccount = await this.ledgerRepo.getAccountByCode("2010_CUSTOMER_ESCROW_HOLDING");
    } catch {
      holdingAccount = await this.ledgerRepo.createAccount({
        name: "CUSTOMER_ESCROW_HOLDING",
        code: "2010_CUSTOMER_ESCROW_HOLDING",
        type: "LIABILITY" as any,
      });
    }

    try {
      payoutAccount = await this.ledgerRepo.getAccountByCode("1020_BANK_PAYOUT_CLEARING");
    } catch {
      payoutAccount = await this.ledgerRepo.createAccount({
        name: "BANK_PAYOUT_CLEARING",
        code: "1020_BANK_PAYOUT_CLEARING",
        type: "ASSET" as any,
      });
    }

    await this.ledgerRepo.postTransaction(
      {
        escrow_id: escrowId,
        type: "RELEASE_SETTLEMENT",
        reference: `RELEASE-${releaseId}`,
      },
      [
        {
          ledger_account_id: holdingAccount.id,
          direction: "DEBIT" as any,
          amount,
          currency: "USD",
        },
        {
          ledger_account_id: payoutAccount.id,
          direction: "CREDIT" as any,
          amount,
          currency: "USD",
        },
      ]
    );
  }
}
