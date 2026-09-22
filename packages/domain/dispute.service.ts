import { ActorRole, EscrowStatus } from "./state-machine.js";
import {
  DisputeAction,
  DisputeReason,
  DisputeStatus,
  validateDisputeTransition,
} from "./dispute-state-machine.js";
import type { AuditLogRepository } from "../database/repositories/audit-log.repository.js";
import type { DisputeAssignmentRepository } from "../database/repositories/dispute-assignment.repository.js";
import type { DisputeEventRepository } from "../database/repositories/dispute-event.repository.js";
import type { DisputeEvidenceRepository } from "../database/repositories/dispute-evidence.repository.js";
import type { DisputeRepository } from "../database/repositories/dispute.repository.js";
import type { EscrowRepository } from "../database/repositories/escrow.repository.js";
import type { UserRepository } from "../database/repositories/user.repository.js";
import type { Dispute, EscrowTransaction } from "../database/types/index.js";

export class DuplicateActiveDisputeError extends Error {
  constructor(message = "An active dispute already exists for this escrow transaction") {
    super(message);
    this.name = "DuplicateActiveDisputeError";
  }
}

export class DisputeIneligibleError extends Error {
  constructor(message = "Escrow transaction is not eligible for dispute") {
    super(message);
    this.name = "DisputeIneligibleError";
  }
}

export interface CreateDisputeInput {
  escrowId: string;
  openedByUserId: string;
  openedByUserRole: ActorRole | string;
  reason: DisputeReason | string;
  description?: string;
  initialEvidenceIds?: string[];
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface DisputeActionInput {
  disputeId: string;
  action: DisputeAction | string;
  targetStatus: DisputeStatus;
  actorId: string;
  actorRole: ActorRole | string;
  reason: string;
  resolutionText?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export class DisputeService {
  constructor(
    private readonly disputeRepo: DisputeRepository,
    private readonly disputeEventRepo: DisputeEventRepository,
    private readonly disputeEvidenceRepo: DisputeEvidenceRepository,
    private readonly disputeAssignmentRepo: DisputeAssignmentRepository,
    private readonly escrowRepo: EscrowRepository,
    private readonly userRepo: UserRepository,
    private readonly auditRepo: AuditLogRepository
  ) {}

  async createDispute(input: CreateDisputeInput): Promise<Dispute> {
    const escrow = await this.escrowRepo.findById(input.escrowId);
    if (!escrow) {
      throw new Error(`Escrow transaction ${input.escrowId} not found`);
    }

    const isBuyer = escrow.buyer_id === input.openedByUserId;
    const isSeller = escrow.seller_id === input.openedByUserId;
    const isStaff =
      input.openedByUserRole === ActorRole.SUPPORT ||
      input.openedByUserRole === ActorRole.ADMIN ||
      input.openedByUserRole === ActorRole.SYSTEM ||
      input.openedByUserRole === "SUPER_ADMIN";

    if (!isBuyer && !isSeller && !isStaff) {
      throw new Error("Unauthorized: Only escrow participants or authorized staff may open a dispute");
    }

    // Check for existing active dispute
    const activeDispute = await this.disputeRepo.findActiveByEscrowId(input.escrowId);
    if (activeDispute) {
      throw new DuplicateActiveDisputeError();
    }

    // Escrow must be in a disputable state
    if (
      escrow.status === EscrowStatus.RELEASED ||
      escrow.status === EscrowStatus.REFUNDED ||
      escrow.status === EscrowStatus.EXPIRED ||
      escrow.status === EscrowStatus.CANCELLED
    ) {
      throw new DisputeIneligibleError(`Cannot dispute escrow in terminal state: ${escrow.status}`);
    }

    // Transition Escrow state to DISPUTED via domain state machine
    if (escrow.status !== EscrowStatus.DISPUTED) {
      await this.escrowRepo.transitionStatus({
        transactionId: escrow.id,
        previousState: escrow.status,
        newState: EscrowStatus.DISPUTED,
        actorId: input.openedByUserId,
        actorRole: input.openedByUserRole as ActorRole,
        timestamp: new Date().toISOString(),
        reason: `Dispute opened: ${input.reason}`,
        metadata: {
          dispute_reason: input.reason,
        },
      });
    }

    // Create dispute entity
    const dispute = await this.disputeRepo.create({
      escrow_id: input.escrowId,
      opened_by: input.openedByUserId,
      reason: input.reason,
      description: input.description ?? null,
      status: DisputeStatus.OPEN,
      opened_at: new Date(),
    });

    // Record dispute event
    await this.disputeEventRepo.createEvent({
      dispute_id: dispute.id,
      previous_status: null,
      new_status: DisputeStatus.OPEN,
      actor_id: input.openedByUserId,
      actor_role: input.openedByUserRole,
      action: DisputeAction.OPEN,
      reason: input.description ?? input.reason,
      metadata: input.metadata ?? null,
    });

    // Link initial evidence if provided
    if (input.initialEvidenceIds && input.initialEvidenceIds.length > 0) {
      for (const evId of input.initialEvidenceIds) {
        await this.disputeEvidenceRepo.linkEvidence({
          dispute_id: dispute.id,
          evidence_id: evId,
          submitted_by: input.openedByUserId,
        });
      }
    }

    // Audit log
    await this.auditRepo.create({
      actor_id: input.openedByUserId,
      action: "DISPUTE_CREATED",
      entity_type: "DISPUTE",
      entity_id: dispute.id,
      previous_state: escrow.status,
      new_state: EscrowStatus.DISPUTED,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      metadata: {
        escrow_id: input.escrowId,
        reason: input.reason,
      },
    });

    return dispute;
  }

  async executeAction(input: DisputeActionInput): Promise<Dispute> {
    const dispute = await this.disputeRepo.findById(input.disputeId);
    if (!dispute) {
      throw new Error(`Dispute ${input.disputeId} not found`);
    }

    const currentStatus = (dispute.status as DisputeStatus) ?? DisputeStatus.OPEN;

    // Validate state transition and actor authorization
    validateDisputeTransition(
      currentStatus,
      input.targetStatus,
      input.actorRole,
      input.action
    );

    const isResolution = [
      DisputeStatus.RESOLVED_BUYER,
      DisputeStatus.RESOLVED_SELLER,
      DisputeStatus.RESOLVED_SPLIT,
    ].includes(input.targetStatus);

    const updated = await this.disputeRepo.updateStatus(
      dispute.id,
      input.targetStatus,
      isResolution ? input.actorId : null,
      input.resolutionText ?? input.reason,
      input.reason
    );

    // Record dispute event
    await this.disputeEventRepo.createEvent({
      dispute_id: dispute.id,
      previous_status: currentStatus,
      new_status: input.targetStatus,
      actor_id: input.actorId,
      actor_role: input.actorRole,
      action: input.action,
      reason: input.reason,
      metadata: input.metadata ?? null,
    });

    // Audit log
    await this.auditRepo.create({
      actor_id: input.actorId,
      action: `DISPUTE_ACTION_${input.action}`,
      entity_type: "DISPUTE",
      entity_id: dispute.id,
      previous_state: currentStatus,
      new_state: input.targetStatus,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      metadata: {
        action: input.action,
        reason: input.reason,
      },
    });

    return updated;
  }

  async assignDispute(
    disputeId: string,
    assignToUserId: string,
    assignedBy: { id: string; role: ActorRole | string },
    context?: { ipAddress?: string; userAgent?: string }
  ): Promise<Dispute> {
    const isStaff =
      assignedBy.role === ActorRole.SUPPORT ||
      assignedBy.role === ActorRole.ADMIN ||
      assignedBy.role === ActorRole.SYSTEM ||
      assignedBy.role === "SUPER_ADMIN";

    if (!isStaff) {
      throw new Error("Unauthorized: Only operational roles (SUPPORT, ADMIN, SUPER_ADMIN) may assign disputes");
    }

    const assignee = await this.userRepo.findById(assignToUserId);
    if (!assignee) {
      throw new Error(`Assignee user ${assignToUserId} not found`);
    }

    const isAssigneeStaff =
      assignee.role === ActorRole.SUPPORT ||
      assignee.role === ActorRole.ADMIN ||
      assignee.role === ActorRole.SYSTEM ||
      assignee.role === "SUPER_ADMIN";

    if (!isAssigneeStaff) {
      throw new Error("Dispute cannot be assigned to non-operational role");
    }

    const updated = await this.disputeRepo.assign(disputeId, assignToUserId);

    await this.disputeAssignmentRepo.createAssignment({
      dispute_id: disputeId,
      assigned_to: assignToUserId,
      assigned_by: assignedBy.id,
    });

    await this.disputeEventRepo.createEvent({
      dispute_id: disputeId,
      previous_status: updated.status,
      new_status: updated.status ?? DisputeStatus.OPEN,
      actor_id: assignedBy.id,
      actor_role: assignedBy.role,
      action: DisputeAction.ASSIGN,
      reason: `Dispute assigned to user ${assignToUserId}`,
    });

    await this.auditRepo.create({
      actor_id: assignedBy.id,
      action: "DISPUTE_ASSIGNED",
      entity_type: "DISPUTE",
      entity_id: disputeId,
      previous_state: null,
      new_state: updated.status,
      ip_address: context?.ipAddress ?? null,
      user_agent: context?.userAgent ?? null,
      metadata: {
        assigned_to: assignToUserId,
      },
    });

    return updated;
  }
}
