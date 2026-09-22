import { ActorRole } from "./state-machine.js";
import { DisputeAction, DisputeStatus } from "./dispute-state-machine.js";
import type { DisputeService } from "./dispute.service.js";
import type { RefundService } from "./refund.service.js";
import type { ReleaseService } from "./release.service.js";
import type { AuditLogRepository } from "../database/repositories/audit-log.repository.js";
import type { DisputeRepository } from "../database/repositories/dispute.repository.js";
import type { Dispute, Refund, Release } from "../database/types/index.js";

export interface DisputeResolutionInput {
  disputeId: string;
  resolvedByUserId: string;
  resolvedByUserRole: ActorRole | string;
  resolutionReason: string;
  resolutionText?: string;
  idempotencyKey: string;
  ipAddress?: string;
  userAgent?: string;
}

export class DisputeResolutionService {
  constructor(
    private readonly disputeService: DisputeService,
    private readonly disputeRepo: DisputeRepository,
    private readonly releaseService: ReleaseService,
    private readonly refundService: RefundService,
    private readonly auditRepo: AuditLogRepository
  ) {}

  private checkOperationalRole(role: ActorRole | string): void {
    const isStaff =
      role === ActorRole.SUPPORT ||
      role === ActorRole.ADMIN ||
      role === ActorRole.SYSTEM ||
      role === "SUPER_ADMIN";

    if (!isStaff) {
      throw new Error(`Role '${role}' is not authorized to resolve disputes. Operational review required.`);
    }
  }

  async resolveToBuyer(input: DisputeResolutionInput): Promise<{ dispute: Dispute; refund: Refund }> {
    this.checkOperationalRole(input.resolvedByUserRole);

    const dispute = await this.disputeRepo.findById(input.disputeId);
    if (!dispute) {
      throw new Error(`Dispute ${input.disputeId} not found`);
    }

    // 1. Transition Dispute state
    const updatedDispute = await this.disputeService.executeAction({
      disputeId: dispute.id,
      action: DisputeAction.RESOLVE_BUYER,
      targetStatus: DisputeStatus.RESOLVED_BUYER,
      actorId: input.resolvedByUserId,
      actorRole: input.resolvedByUserRole,
      reason: input.resolutionReason,
      resolutionText: input.resolutionText ?? input.resolutionReason,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    // 2. Trigger authorized refund workflow
    const refund = await this.refundService.requestRefund({
      escrowId: dispute.escrow_id,
      requestedBy: input.resolvedByUserId,
      actorRole: input.resolvedByUserRole,
      idempotencyKey: input.idempotencyKey,
      isDisputeResolution: true,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    await this.auditRepo.create({
      actor_id: input.resolvedByUserId,
      action: "DISPUTE_RESOLVED_BUYER_FINANCIAL_SETTLED",
      entity_type: "DISPUTE",
      entity_id: dispute.id,
      previous_state: dispute.status,
      new_state: DisputeStatus.RESOLVED_BUYER,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      metadata: {
        escrow_id: dispute.escrow_id,
        refund_id: refund.id,
        amount: refund.amount,
      },
    });

    return { dispute: updatedDispute, refund };
  }

  async resolveToSeller(input: DisputeResolutionInput): Promise<{ dispute: Dispute; release: Release }> {
    this.checkOperationalRole(input.resolvedByUserRole);

    const dispute = await this.disputeRepo.findById(input.disputeId);
    if (!dispute) {
      throw new Error(`Dispute ${input.disputeId} not found`);
    }

    // 1. Transition Dispute state
    const updatedDispute = await this.disputeService.executeAction({
      disputeId: dispute.id,
      action: DisputeAction.RESOLVE_SELLER,
      targetStatus: DisputeStatus.RESOLVED_SELLER,
      actorId: input.resolvedByUserId,
      actorRole: input.resolvedByUserRole,
      reason: input.resolutionReason,
      resolutionText: input.resolutionText ?? input.resolutionReason,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    // 2. Trigger authorized release workflow
    const release = await this.releaseService.requestRelease({
      escrowId: dispute.escrow_id,
      requestedBy: input.resolvedByUserId,
      actorRole: input.resolvedByUserRole,
      idempotencyKey: input.idempotencyKey,
      isDisputeResolution: true,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    await this.auditRepo.create({
      actor_id: input.resolvedByUserId,
      action: "DISPUTE_RESOLVED_SELLER_FINANCIAL_SETTLED",
      entity_type: "DISPUTE",
      entity_id: dispute.id,
      previous_state: dispute.status,
      new_state: DisputeStatus.RESOLVED_SELLER,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      metadata: {
        escrow_id: dispute.escrow_id,
        release_id: release.id,
        amount: release.amount,
      },
    });

    return { dispute: updatedDispute, release };
  }

  async resolveSplit(input: DisputeResolutionInput): Promise<{ dispute: Dispute }> {
    this.checkOperationalRole(input.resolvedByUserRole);

    const dispute = await this.disputeRepo.findById(input.disputeId);
    if (!dispute) {
      throw new Error(`Dispute ${input.disputeId} not found`);
    }

    const note = "RESOLVED_SPLIT marked for dispute resolution. Dispute resolution does not directly mutate financial balances. All financial effects must pass through existing ReleaseService/RefundService and ledger controls once split settlement capability is supported.";

    const updatedDispute = await this.disputeService.executeAction({
      disputeId: dispute.id,
      action: DisputeAction.RESOLVE_SPLIT,
      targetStatus: DisputeStatus.RESOLVED_SPLIT,
      actorId: input.resolvedByUserId,
      actorRole: input.resolvedByUserRole,
      reason: `${input.resolutionReason} (${note})`,
      resolutionText: input.resolutionText ?? input.resolutionReason,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    await this.auditRepo.create({
      actor_id: input.resolvedByUserId,
      action: "DISPUTE_RESOLVED_SPLIT_MARKED",
      entity_type: "DISPUTE",
      entity_id: dispute.id,
      previous_state: dispute.status,
      new_state: DisputeStatus.RESOLVED_SPLIT,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      metadata: {
        escrow_id: dispute.escrow_id,
        note,
      },
    });

    return { dispute: updatedDispute };
  }
}
