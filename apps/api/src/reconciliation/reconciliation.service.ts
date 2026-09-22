import {
  ActorRole,
  EscrowStatus,
} from "@escrow-ecuador/domain";
import {
  AuditLogRepository,
  DbClient,
  EscrowRepository,
  LedgerRepository,
  Release,
  ReleaseRepository,
} from "@escrow-ecuador/database";
import { FiduciaryProvider } from "@escrow-ecuador/providers";
import { postConfirmedReleaseLedger } from "../shared/ledger-helper.js";

export class FiduciaryReconciliationService {
  constructor(
    private readonly db: DbClient,
    private readonly escrowRepo: EscrowRepository,
    private readonly releaseRepo: ReleaseRepository,
    private readonly ledgerRepo: LedgerRepository,
    private readonly auditRepo: AuditLogRepository,
    private readonly fiduciaryProvider: FiduciaryProvider
  ) {}

  async reconcileRelease(releaseId: string, actorId: string, actorRole: ActorRole): Promise<Release> {
    const isAllowedRole = [
      ActorRole.ADMIN,
      ActorRole.SUPER_ADMIN,
      ActorRole.SUPPORT,
      ActorRole.SYSTEM,
    ].includes(actorRole);

    if (!isAllowedRole) {
      throw new Error(`UNAUTHORIZED_RECONCILIATION: Role '${actorRole}' is strictly prohibited from executing manual reconciliation`);
    }

    const release = await this.releaseRepo.findById(releaseId);
    if (!release) {
      throw new Error(`Release record ${releaseId} not found`);
    }

    if (!release.provider_release_id) {
      throw new Error(`Release record ${releaseId} has no provider transaction ID; cannot reconcile with provider`);
    }

    const providerStatus = await this.fiduciaryProvider.getTransactionStatus({
      providerReference: release.provider_release_id,
      escrowId: release.escrow_id,
    });

    const escrow = await this.escrowRepo.findById(release.escrow_id);
    if (!escrow) {
      throw new Error(`Escrow transaction ${release.escrow_id} not found`);
    }

    if (providerStatus.status === "COMPLETED" && release.status !== "COMPLETED") {
      if (escrow.status !== EscrowStatus.RELEASED) {
        await this.escrowRepo.transitionStatus({
          transactionId: escrow.id,
          previousState: escrow.status,
          newState: EscrowStatus.RELEASED,
          actorId,
          actorRole,
          timestamp: new Date(),
          reason: "Fiduciary reconciliation confirmed successful payout",
        });
      }

      await postConfirmedReleaseLedger({
        ledgerRepo: this.ledgerRepo,
        escrowId: escrow.id,
        amount: escrow.amount,
        currency: escrow.currency,
        providerReference: release.provider_release_id,
      });

      const updated = await this.releaseRepo.updateReleaseStatus(release.id, "COMPLETED", {
        completedAt: new Date(),
      });

      await this.auditRepo.create({
        actor_id: actorId,
        action: "RELEASE_RECONCILED_SUCCESS",
        entity_type: "RELEASE",
        entity_id: release.id,
        previous_state: release.status,
        new_state: "COMPLETED",
        metadata: { provider_release_id: release.provider_release_id, provider_status: providerStatus.status },
      });

      return updated;
    } else if (providerStatus.status === "FAILED" && release.status !== "FAILED") {
      const updated = await this.releaseRepo.updateReleaseStatus(release.id, "FAILED", {
        failureCode: "FIDUCIARY_RECONCILED_FAILED",
        failureReason: "Provider reports transaction failed upon reconciliation",
      });

      await this.auditRepo.create({
        actor_id: actorId,
        action: "RELEASE_RECONCILED_FAILED",
        entity_type: "RELEASE",
        entity_id: release.id,
        previous_state: release.status,
        new_state: "FAILED",
        metadata: { provider_release_id: release.provider_release_id, provider_status: providerStatus.status },
      });

      return updated;
    } else if (providerStatus.status === "MISMATCH" || providerStatus.status === "UNKNOWN") {
      const updated = await this.releaseRepo.updateReleaseStatus(release.id, "REVIEW_REQUIRED", {
        failureCode: providerStatus.status === "MISMATCH" ? "PROVIDER_AMOUNT_MISMATCH" : "PROVIDER_STATUS_UNKNOWN",
        failureReason: "Status or amount mismatch detected during provider reconciliation; flagged for manual review",
      });

      await this.auditRepo.create({
        actor_id: actorId,
        action: "RELEASE_RECONCILED_REVIEW_REQUIRED",
        entity_type: "RELEASE",
        entity_id: release.id,
        previous_state: release.status,
        new_state: "REVIEW_REQUIRED",
        metadata: { provider_release_id: release.provider_release_id, provider_status: providerStatus.status },
      });

      return updated;
    } else {
      return release;
    }
  }
}
