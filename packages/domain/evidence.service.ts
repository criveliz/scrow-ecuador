import { ActorRole } from "./state-machine.js";
import {
  EvidenceIntegrityMismatchError,
  InvalidEvidenceFileError,
  SensitiveDataDetectedError,
  checkSensitiveData,
  sanitizeFilename,
  validateFileSize,
  validateMimeType,
  verifySha256,
} from "./evidence-integrity.js";
import type { AuditLogRepository } from "../database/repositories/audit-log.repository.js";
import type { EscrowRepository } from "../database/repositories/escrow.repository.ts";
import type { EvidenceRepository } from "../database/repositories/evidence.repository.js";
import type { EscrowTransaction, Evidence, User } from "../database/types/index.js";
import type { EvidenceStorageProvider } from "../providers/interfaces.js";

export enum EvidenceType {
  PAYMENT_PROOF = "PAYMENT_PROOF",
  DELIVERY_PROOF = "DELIVERY_PROOF",
  PRODUCT_PHOTO = "PRODUCT_PHOTO",
  PRODUCT_VIDEO = "PRODUCT_VIDEO",
  SHIPPING_DOCUMENT = "SHIPPING_DOCUMENT",
  TRACKING_NUMBER = "TRACKING_NUMBER",
  IDENTITY_DOCUMENT = "IDENTITY_DOCUMENT",
  COMMUNICATION = "COMMUNICATION",
  CONTRACT = "CONTRACT",
  RECEIPT = "RECEIPT",
  OTHER = "OTHER",
}

export enum EvidenceVisibility {
  PRIVATE = "PRIVATE",
  PARTICIPANTS = "PARTICIPANTS",
  SUPPORT = "SUPPORT",
  ADMIN = "ADMIN",
  DISPUTE_REVIEW = "DISPUTE_REVIEW",
}

export enum EvidenceStatus {
  ACTIVE = "ACTIVE",
  VERIFIED = "VERIFIED",
  REPLACED = "REPLACED",
  REJECTED = "REJECTED",
  INTEGRITY_FAILED = "INTEGRITY_FAILED",
}

export class UnauthorizedEvidenceAccessError extends Error {
  constructor(message = "Unauthorized access to evidence resource") {
    super(message);
    this.name = "UnauthorizedEvidenceAccessError";
  }
}

export interface UploadEvidenceInput {
  escrowId: string;
  uploadedBy: string;
  type: EvidenceType | string;
  description?: string;
  filename: string;
  mimeType: string;
  content: Buffer;
  visibility?: EvidenceVisibility | string;
  capturedAt?: Date | string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export class EvidenceService {
  constructor(
    private readonly evidenceRepo: EvidenceRepository,
    private readonly escrowRepo: EscrowRepository,
    private readonly auditRepo: AuditLogRepository,
    private readonly storageProvider: EvidenceStorageProvider
  ) {}

  /**
   * Enforces IDOR & Visibility rules for evidence access.
   */
  async checkAccessPermission(
    user: { id: string; role: ActorRole | string },
    escrow: EscrowTransaction,
    evidence: Evidence
  ): Promise<boolean> {
    const isBuyer = escrow.buyer_id === user.id;
    const isSeller = escrow.seller_id === user.id;
    const isParticipant = isBuyer || isSeller;
    const isStaff =
      user.role === ActorRole.SUPPORT ||
      user.role === ActorRole.ADMIN ||
      user.role === ActorRole.SYSTEM ||
      user.role === "SUPER_ADMIN";

    if (isStaff) return true;

    if (!isParticipant) {
      // Unrelated user -> IDOR blocked
      return false;
    }

    const visibility = evidence.visibility ?? EvidenceVisibility.PARTICIPANTS;

    if (visibility === EvidenceVisibility.PRIVATE) {
      // PRIVATE is accessible only by creator or staff
      return evidence.uploaded_by === user.id;
    }

    if (visibility === EvidenceVisibility.PARTICIPANTS || visibility === EvidenceVisibility.DISPUTE_REVIEW) {
      return true;
    }

    if (visibility === EvidenceVisibility.SUPPORT || visibility === EvidenceVisibility.ADMIN) {
      return false;
    }

    return true;
  }

  async uploadEvidence(input: UploadEvidenceInput): Promise<Evidence> {
    const escrow = await this.escrowRepo.findById(input.escrowId);
    if (!escrow) {
      throw new Error(`Escrow ${input.escrowId} not found`);
    }

    // Security & Integrity validations
    validateFileSize(input.content.length);
    validateMimeType(input.mimeType);
    const cleanFilename = sanitizeFilename(input.filename);

    if (input.description) {
      checkSensitiveData(input.description);
    }
    if (input.metadata) {
      checkSensitiveData(JSON.stringify(input.metadata));
    }

    const storageKey = `escrows/${input.escrowId}/${crypto.randomUUID()}-${cleanFilename}`;

    const storedResult = await this.storageProvider.putObject({
      key: storageKey,
      content: input.content,
      mimeType: input.mimeType,
    });

    const sha256 = storedResult.sha256;

    // Verify hash
    if (!verifySha256(input.content, sha256)) {
      throw new EvidenceIntegrityMismatchError(sha256, "calculated_mismatch");
    }

    const record = await this.evidenceRepo.create({
      escrow_id: input.escrowId,
      uploaded_by: input.uploadedBy,
      type: input.type,
      description: input.description ?? null,
      storage_reference: storageKey,
      sha256,
      mime_type: input.mimeType,
      file_size: input.content.length,
      original_filename: cleanFilename,
      captured_at: input.capturedAt ? new Date(input.capturedAt) : null,
      status: EvidenceStatus.ACTIVE,
      visibility: input.visibility ?? EvidenceVisibility.PARTICIPANTS,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      metadata: input.metadata ?? null,
    });

    // Audit log
    await this.auditRepo.create({
      actor_id: input.uploadedBy,
      action: "EVIDENCE_UPLOADED",
      entity_type: "EVIDENCE",
      entity_id: record.id,
      previous_state: null,
      new_state: record.status,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      metadata: {
        escrow_id: input.escrowId,
        sha256,
        type: input.type,
        filename: cleanFilename,
      },
    });

    return record;
  }

  async verifyIntegrity(evidenceId: string, actorId?: string): Promise<{ verified: boolean; sha256: string }> {
    const evidence = await this.evidenceRepo.findById(evidenceId);
    if (!evidence) {
      throw new Error(`Evidence ${evidenceId} not found`);
    }

    const objectData = await this.storageProvider.getObject(evidence.storage_reference);
    const calculatedHash = this.storageProvider.calculateHash(objectData.content);

    const matches = evidence.sha256?.toLowerCase() === calculatedHash.toLowerCase();

    if (!matches) {
      await this.evidenceRepo.updateStatus(evidenceId, EvidenceStatus.INTEGRITY_FAILED);

      await this.auditRepo.create({
        actor_id: actorId ?? null,
        action: "EVIDENCE_INTEGRITY_FAILURE",
        entity_type: "EVIDENCE",
        entity_id: evidenceId,
        previous_state: evidence.status,
        new_state: EvidenceStatus.INTEGRITY_FAILED,
        metadata: {
          expected_sha256: evidence.sha256,
          actual_sha256: calculatedHash,
        },
      });

      throw new EvidenceIntegrityMismatchError(evidence.sha256 ?? "", calculatedHash);
    }

    await this.evidenceRepo.updateStatus(evidenceId, EvidenceStatus.VERIFIED);

    await this.auditRepo.create({
      actor_id: actorId ?? null,
      action: "EVIDENCE_INTEGRITY_VERIFIED",
      entity_type: "EVIDENCE",
      entity_id: evidenceId,
      previous_state: evidence.status,
      new_state: EvidenceStatus.VERIFIED,
      metadata: {
        sha256: calculatedHash,
      },
    });

    return { verified: true, sha256: calculatedHash };
  }

  async getEvidence(
    evidenceId: string,
    currentUser: { id: string; role: ActorRole | string },
    context?: { ipAddress?: string; userAgent?: string }
  ): Promise<{ record: Evidence; downloadUrl: string }> {
    const evidence = await this.evidenceRepo.findById(evidenceId);
    if (!evidence) {
      throw new Error(`Evidence ${evidenceId} not found`);
    }

    const escrow = await this.escrowRepo.findById(evidence.escrow_id);
    if (!escrow) {
      throw new Error(`Associated escrow ${evidence.escrow_id} not found`);
    }

    const allowed = await this.checkAccessPermission(currentUser, escrow, evidence);
    if (!allowed) {
      throw new UnauthorizedEvidenceAccessError(
        `User ${currentUser.id} is not authorized to access evidence ${evidenceId}`
      );
    }

    // Record access audit event
    await this.evidenceRepo.createAccessEvent({
      evidence_id: evidenceId,
      actor_id: currentUser.id,
      action: "EVIDENCE_VIEWED",
      ip_address: context?.ipAddress ?? null,
      user_agent: context?.userAgent ?? null,
    });

    const downloadUrl = await this.storageProvider.getDownloadUrl(evidence.storage_reference, 3600);

    return { record: evidence, downloadUrl };
  }

  async replaceEvidence(
    oldEvidenceId: string,
    newInput: UploadEvidenceInput,
    currentUser: { id: string; role: ActorRole | string }
  ): Promise<{ oldRecord: Evidence; newRecord: Evidence }> {
    const oldEvidence = await this.evidenceRepo.findById(oldEvidenceId);
    if (!oldEvidence) {
      throw new Error(`Original evidence ${oldEvidenceId} not found`);
    }

    const escrow = await this.escrowRepo.findById(oldEvidence.escrow_id);
    if (!escrow) {
      throw new Error(`Escrow ${oldEvidence.escrow_id} not found`);
    }

    const allowed = await this.checkAccessPermission(currentUser, escrow, oldEvidence);
    if (!allowed) {
      throw new UnauthorizedEvidenceAccessError("Not authorized to replace evidence");
    }

    // Create new evidence record
    const newRecord = await this.uploadEvidence(newInput);

    // Mark old as REPLACED pointing to new ID
    const updatedOld = await this.evidenceRepo.markReplaced(oldEvidenceId, newRecord.id);

    await this.auditRepo.create({
      actor_id: currentUser.id,
      action: "EVIDENCE_REPLACED",
      entity_type: "EVIDENCE",
      entity_id: oldEvidenceId,
      previous_state: oldEvidence.status,
      new_state: EvidenceStatus.REPLACED,
      metadata: {
        replacement_evidence_id: newRecord.id,
      },
    });

    return { oldRecord: updatedOld, newRecord };
  }
}
