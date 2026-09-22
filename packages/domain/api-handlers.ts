import { ActorRole } from "./state-machine.js";
import { DisputeAction, DisputeReason, DisputeStatus } from "./dispute-state-machine.js";
import type { DisputeDeadlineService } from "./dispute-deadline.service.js";
import type { DisputeResolutionService } from "./dispute-resolution.service.js";
import type { DisputeService } from "./dispute.service.js";
import type { EvidenceService } from "./evidence.service.js";
import type { DisputeEvidenceRepository } from "../database/repositories/dispute-evidence.repository.js";
import type { DisputeEventRepository } from "../database/repositories/dispute-event.repository.js";
import type { DisputeRepository } from "../database/repositories/dispute.repository.js";
import type { EscrowRepository } from "../database/repositories/escrow.repository.js";

export interface RequestContext {
  user?: {
    id: string;
    role: ActorRole | string;
  };
  ipAddress?: string;
  userAgent?: string;
  idempotencyKey?: string;
}

export interface ApiResponse<T = any> {
  status: number;
  body: {
    success: boolean;
    data?: T;
    error?: string;
    code?: string;
  };
}

export class EvidenceAndDisputeApiRouter {
  constructor(
    private readonly evidenceService: EvidenceService,
    private readonly disputeService: DisputeService,
    private readonly disputeResolutionService: DisputeResolutionService,
    private readonly disputeDeadlineService: DisputeDeadlineService,
    private readonly disputeRepo: DisputeRepository,
    private readonly disputeEventRepo: DisputeEventRepository,
    private readonly disputeEvidenceRepo: DisputeEvidenceRepository,
    private readonly escrowRepo: EscrowRepository
  ) {}

  async handleUploadEvidence(
    escrowId: string,
    body: {
      type: string;
      description?: string;
      filename: string;
      mimeType: string;
      content: Buffer;
      visibility?: string;
      metadata?: Record<string, unknown>;
    },
    ctx: RequestContext
  ): Promise<ApiResponse> {
    if (!ctx.user) {
      return { status: 401, body: { success: false, error: "Unauthorized", code: "UNAUTHORIZED" } };
    }

    try {
      const record = await this.evidenceService.uploadEvidence({
        escrowId,
        uploadedBy: ctx.user.id,
        type: body.type,
        description: body.description,
        filename: body.filename,
        mimeType: body.mimeType,
        content: body.content,
        visibility: body.visibility,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: body.metadata,
      });

      return { status: 201, body: { success: true, data: record } };
    } catch (err: any) {
      return { status: 400, body: { success: false, error: err.message, code: err.name } };
    }
  }

  async handleListEscrowEvidence(escrowId: string, ctx: RequestContext): Promise<ApiResponse> {
    if (!ctx.user) {
      return { status: 401, body: { success: false, error: "Unauthorized", code: "UNAUTHORIZED" } };
    }

    try {
      const escrow = await this.escrowRepo.findById(escrowId);
      if (!escrow) {
        return { status: 404, body: { success: false, error: "Escrow not found", code: "NOT_FOUND" } };
      }

      // Authorization check
      const isBuyer = escrow.buyer_id === ctx.user.id;
      const isSeller = escrow.seller_id === ctx.user.id;
      const isStaff =
        ctx.user.role === ActorRole.SUPPORT ||
        ctx.user.role === ActorRole.ADMIN ||
        ctx.user.role === ActorRole.SYSTEM ||
        ctx.user.role === "SUPER_ADMIN";

      if (!isBuyer && !isSeller && !isStaff) {
        return { status: 403, body: { success: false, error: "Forbidden: Not an escrow participant", code: "FORBIDDEN" } };
      }

      const list = await this.evidenceService["evidenceRepo"].findByEscrowId(escrowId);
      const filtered = [];

      for (const item of list) {
        const allowed = await this.evidenceService.checkAccessPermission(ctx.user, escrow, item);
        if (allowed) filtered.push(item);
      }

      return { status: 200, body: { success: true, data: filtered } };
    } catch (err: any) {
      return { status: 500, body: { success: false, error: err.message } };
    }
  }

  async handleGetEvidenceDownload(evidenceId: string, ctx: RequestContext): Promise<ApiResponse> {
    if (!ctx.user) {
      return { status: 401, body: { success: false, error: "Unauthorized", code: "UNAUTHORIZED" } };
    }

    try {
      const res = await this.evidenceService.getEvidence(evidenceId, ctx.user, {
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return { status: 200, body: { success: true, data: res } };
    } catch (err: any) {
      const status = err.name === "UnauthorizedEvidenceAccessError" ? 403 : 404;
      return { status, body: { success: false, error: err.message, code: err.name } };
    }
  }

  async handleVerifyEvidence(evidenceId: string, ctx: RequestContext): Promise<ApiResponse> {
    if (!ctx.user) {
      return { status: 401, body: { success: false, error: "Unauthorized", code: "UNAUTHORIZED" } };
    }

    try {
      const res = await this.evidenceService.verifyIntegrity(evidenceId, ctx.user.id);
      return { status: 200, body: { success: true, data: res } };
    } catch (err: any) {
      return { status: 400, body: { success: false, error: err.message, code: err.name } };
    }
  }

  async handleCreateDispute(
    escrowId: string,
    body: { reason: DisputeReason | string; description?: string; initialEvidenceIds?: string[] },
    ctx: RequestContext
  ): Promise<ApiResponse> {
    if (!ctx.user) {
      return { status: 401, body: { success: false, error: "Unauthorized", code: "UNAUTHORIZED" } };
    }

    try {
      const dispute = await this.disputeService.createDispute({
        escrowId,
        openedByUserId: ctx.user.id,
        openedByUserRole: ctx.user.role,
        reason: body.reason,
        description: body.description,
        initialEvidenceIds: body.initialEvidenceIds,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return { status: 201, body: { success: true, data: dispute } };
    } catch (err: any) {
      return { status: 400, body: { success: false, error: err.message, code: err.name } };
    }
  }

  async handleGetDispute(disputeId: string, ctx: RequestContext): Promise<ApiResponse> {
    if (!ctx.user) {
      return { status: 401, body: { success: false, error: "Unauthorized", code: "UNAUTHORIZED" } };
    }

    try {
      const dispute = await this.disputeRepo.findById(disputeId);
      if (!dispute) {
        return { status: 404, body: { success: false, error: "Dispute not found", code: "NOT_FOUND" } };
      }

      const escrow = await this.escrowRepo.findById(dispute.escrow_id);
      if (!escrow) {
        return { status: 404, body: { success: false, error: "Escrow not found", code: "NOT_FOUND" } };
      }

      const isBuyer = escrow.buyer_id === ctx.user.id;
      const isSeller = escrow.seller_id === ctx.user.id;
      const isStaff =
        ctx.user.role === ActorRole.SUPPORT ||
        ctx.user.role === ActorRole.ADMIN ||
        ctx.user.role === ActorRole.SYSTEM ||
        ctx.user.role === "SUPER_ADMIN";

      if (!isBuyer && !isSeller && !isStaff) {
        return { status: 403, body: { success: false, error: "Forbidden: Not authorized to view dispute", code: "FORBIDDEN" } };
      }

      return { status: 200, body: { success: true, data: dispute } };
    } catch (err: any) {
      return { status: 500, body: { success: false, error: err.message } };
    }
  }

  async handleExecuteDisputeAction(
    disputeId: string,
    body: {
      action: DisputeAction | string;
      targetStatus: DisputeStatus;
      reason: string;
      resolutionText?: string;
    },
    ctx: RequestContext
  ): Promise<ApiResponse> {
    if (!ctx.user) {
      return { status: 401, body: { success: false, error: "Unauthorized", code: "UNAUTHORIZED" } };
    }

    try {
      // Check if action is resolution -> route via DisputeResolutionService
      if (body.targetStatus === DisputeStatus.RESOLVED_BUYER || body.action === DisputeAction.RESOLVE_BUYER) {
        const res = await this.disputeResolutionService.resolveToBuyer({
          disputeId,
          resolvedByUserId: ctx.user.id,
          resolvedByUserRole: ctx.user.role,
          resolutionReason: body.reason,
          resolutionText: body.resolutionText,
          idempotencyKey: ctx.idempotencyKey ?? `res-buyer-${disputeId}`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
        return { status: 200, body: { success: true, data: res } };
      }

      if (body.targetStatus === DisputeStatus.RESOLVED_SELLER || body.action === DisputeAction.RESOLVE_SELLER) {
        const res = await this.disputeResolutionService.resolveToSeller({
          disputeId,
          resolvedByUserId: ctx.user.id,
          resolvedByUserRole: ctx.user.role,
          resolutionReason: body.reason,
          resolutionText: body.resolutionText,
          idempotencyKey: ctx.idempotencyKey ?? `res-seller-${disputeId}`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
        return { status: 200, body: { success: true, data: res } };
      }

      if (body.targetStatus === DisputeStatus.RESOLVED_SPLIT || body.action === DisputeAction.RESOLVE_SPLIT) {
        const res = await this.disputeResolutionService.resolveSplit({
          disputeId,
          resolvedByUserId: ctx.user.id,
          resolvedByUserRole: ctx.user.role,
          resolutionReason: body.reason,
          resolutionText: body.resolutionText,
          idempotencyKey: ctx.idempotencyKey ?? `res-split-${disputeId}`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
        return { status: 200, body: { success: true, data: res } };
      }

      // Standard non-resolution dispute action
      const updated = await this.disputeService.executeAction({
        disputeId,
        action: body.action,
        targetStatus: body.targetStatus,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        reason: body.reason,
        resolutionText: body.resolutionText,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return { status: 200, body: { success: true, data: updated } };
    } catch (err: any) {
      return { status: 400, body: { success: false, error: err.message, code: err.name } };
    }
  }

  async handleGetDisputeHistory(disputeId: string, ctx: RequestContext): Promise<ApiResponse> {
    if (!ctx.user) {
      return { status: 401, body: { success: false, error: "Unauthorized", code: "UNAUTHORIZED" } };
    }

    try {
      const dispute = await this.disputeRepo.findById(disputeId);
      if (!dispute) {
        return { status: 404, body: { success: false, error: "Dispute not found", code: "NOT_FOUND" } };
      }

      const events = await this.disputeEventRepo.findByDisputeId(disputeId);
      return { status: 200, body: { success: true, data: events } };
    } catch (err: any) {
      return { status: 500, body: { success: false, error: err.message } };
    }
  }

  async handleLinkDisputeEvidence(
    disputeId: string,
    body: { evidenceId: string },
    ctx: RequestContext
  ): Promise<ApiResponse> {
    if (!ctx.user) {
      return { status: 401, body: { success: false, error: "Unauthorized", code: "UNAUTHORIZED" } };
    }

    try {
      const linked = await this.disputeEvidenceRepo.linkEvidence({
        dispute_id: disputeId,
        evidence_id: body.evidenceId,
        submitted_by: ctx.user.id,
      });

      return { status: 201, body: { success: true, data: linked } };
    } catch (err: any) {
      return { status: 400, body: { success: false, error: err.message, code: err.name } };
    }
  }

  async handleGetDisputeEvidence(disputeId: string, ctx: RequestContext): Promise<ApiResponse> {
    if (!ctx.user) {
      return { status: 401, body: { success: false, error: "Unauthorized", code: "UNAUTHORIZED" } };
    }

    try {
      const list = await this.disputeEvidenceRepo.findEvidenceRecordsByDisputeId(disputeId);
      return { status: 200, body: { success: true, data: list } };
    } catch (err: any) {
      return { status: 500, body: { success: false, error: err.message } };
    }
  }
}
