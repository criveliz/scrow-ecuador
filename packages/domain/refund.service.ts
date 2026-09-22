import { ActorRole, EscrowStatus } from "./state-machine.js";
import { FinancialFreezeError } from "./financial-freeze.js";
import type { AuditLogRepository } from "../database/repositories/audit-log.repository.js";
import type { DisputeRepository } from "../database/repositories/dispute.repository.js";
import type { EscrowRepository } from "../database/repositories/escrow.repository.js";
import type { LedgerRepository } from "../database/repositories/ledger.repository.js";
import type { ReleaseRepository } from "../database/repositories/release.repository.js";
import type { LedgerAccount, Refund } from "../database/types/index.js";
import type { FiduciaryProvider } from "../providers/interfaces.js";

export interface RefundInput {
  escrowId: string;
  requestedBy: string;
  actorRole: ActorRole | string;
  idempotencyKey: string;
  isDisputeResolution?: boolean;
  ipAddress?: string;
  userAgent?: string;
}

export class RefundService {
  constructor(
    private readonly escrowRepo: EscrowRepository,
    private readonly releaseRepo: ReleaseRepository,
    private readonly disputeRepo: DisputeRepository,
    private readonly ledgerRepo: LedgerRepository,
    private readonly auditRepo: AuditLogRepository,
    private readonly fiduciaryProvider: FiduciaryProvider
  ) {}

  async requestRefund(input: RefundInput): Promise<Refund> {
    const escrow = await this.escrowRepo.findById(input.escrowId);
    if (!escrow) {
      throw new Error(`Escrow ${input.escrowId} not found`);
    }

    // Check for existing completed refund
    const existingRefunds = await this.releaseRepo.findRefundsByEscrowId(input.escrowId);
    const completedRefund = existingRefunds.find((r) => r.status === "COMPLETED" || r.status === "SUCCESS");
    if (completedRefund) {
      return completedRefund;
    }
    if (escrow.status === EscrowStatus.REFUNDED && existingRefunds.length > 0) {
      return existingRefunds[0];
    }

    // 1. Financial Freeze Check
    const activeDispute = await this.disputeRepo.findActiveByEscrowId(input.escrowId);
    if ((activeDispute || escrow.status === EscrowStatus.DISPUTED) && !input.isDisputeResolution) {
      await this.auditRepo.create({
        actor_id: input.requestedBy,
        action: "REFUND_BLOCKED_FINANCIAL_FREEZE",
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

      throw new FinancialFreezeError("Cannot refund funds: Escrow transaction is frozen due to an active dispute.");
    }

    // State transition
    const currentState = escrow.status;
    if (currentState !== EscrowStatus.REFUNDED) {
      await this.escrowRepo.transitionStatus({
        transactionId: escrow.id,
        previousState: currentState,
        newState: EscrowStatus.REFUNDED,
        actorId: input.requestedBy,
        actorRole: input.actorRole as ActorRole,
        timestamp: new Date().toISOString(),
        reason: input.isDisputeResolution ? "Refund triggered by dispute resolution" : "Refund requested",
      });
    }

    // Fiduciary provider call
    const fiduciaryRes = await this.fiduciaryProvider.requestRefund({
      escrowId: escrow.id,
      amount: escrow.amount,
      idempotencyKey: input.idempotencyKey,
    });

    const refundRecord = await this.releaseRepo.createRefund({
      escrow_id: escrow.id,
      amount: escrow.amount,
      currency: escrow.currency,
      status: "COMPLETED",
      provider: "FIDUCIARY_MOCK",
      provider_refund_id: fiduciaryRes.providerReference,
    });

    // Post Double-Entry Ledger Entry
    await this.postRefundLedger(escrow.id, escrow.amount, refundRecord.id);

    await this.auditRepo.create({
      actor_id: input.requestedBy,
      action: "FUNDS_REFUNDED",
      entity_type: "REFUND",
      entity_id: refundRecord.id,
      previous_state: currentState,
      new_state: EscrowStatus.REFUNDED,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      metadata: {
        escrow_id: escrow.id,
        amount: escrow.amount,
        is_dispute_resolution: input.isDisputeResolution ?? false,
      },
    });

    return refundRecord;
  }

  private async postRefundLedger(escrowId: string, amount: string, refundId: string): Promise<void> {
    let holdingAccount: LedgerAccount;
    let refundClearingAccount: LedgerAccount;

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
      refundClearingAccount = await this.ledgerRepo.getAccountByCode("1010_BANK_REFUND_CLEARING");
    } catch {
      refundClearingAccount = await this.ledgerRepo.createAccount({
        name: "BANK_REFUND_CLEARING",
        code: "1010_BANK_REFUND_CLEARING",
        type: "ASSET" as any,
      });
    }

    await this.ledgerRepo.postTransaction(
      {
        escrow_id: escrowId,
        type: "REFUND_SETTLEMENT",
        reference: `REFUND-${refundId}`,
      },
      [
        {
          ledger_account_id: holdingAccount.id,
          direction: "DEBIT" as any,
          amount,
          currency: "USD",
        },
        {
          ledger_account_id: refundClearingAccount.id,
          direction: "CREDIT" as any,
          amount,
          currency: "USD",
        },
      ]
    );
  }
}
