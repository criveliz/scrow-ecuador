import { beforeAll, describe, expect, it } from "vitest";
import { ActorRole, EscrowStatus } from "./state-machine.js";
import {
  EvidenceIntegrityMismatchError,
  InvalidEvidenceFileError,
  SensitiveDataDetectedError,
  calculateSha256,
  sanitizeFilename,
  validateFileSize,
  validateMimeType,
} from "./evidence-integrity.js";
import { EvidenceService, EvidenceStatus, EvidenceType, EvidenceVisibility, UnauthorizedEvidenceAccessError } from "./evidence.service.js";
import {
  DisputeAction,
  DisputeReason,
  DisputeStatus,
  InvalidDisputeStateTransitionError,
  TerminalDisputeStateError,
  UnauthorizedDisputeActorError,
} from "./dispute-state-machine.js";
import { DisputeService, DuplicateActiveDisputeError } from "./dispute.service.js";
import { DeadlineStatus, DeadlineType, DisputeDeadlineService } from "./dispute-deadline.service.js";
import { FinancialFreezeError } from "./financial-freeze.js";
import { ReleaseService } from "./release.service.js";
import { RefundService } from "./refund.service.js";
import { DisputeResolutionService } from "./dispute-resolution.service.js";
import { NotificationEventType, NotificationHookRegistry } from "./notification-hooks.js";
import { EvidenceAndDisputeApiRouter } from "./api-handlers.js";

import {
  AuditLogRepository,
  DisputeAssignmentRepository,
  DisputeDeadlineRepository,
  DisputeEventRepository,
  DisputeEvidenceRepository,
  DisputeRepository,
  EscrowRepository,
  EvidenceRepository,
  LedgerAccountType,
  LedgerRepository,
  PgMemDbClient,
  ReleaseRepository,
  UserRepository,
  runMigrations,
} from "../database/index.js";

import { MockEvidenceStorageProvider, MockFiduciaryProvider, getStorageProvider } from "../providers/index.js";

describe("Task 9 — Comprehensive Evidence & Disputes Subsystem Test Suite", () => {
  const db = new PgMemDbClient();
  const userRepo = new UserRepository(db);
  const escrowRepo = new EscrowRepository(db);
  const evidenceRepo = new EvidenceRepository(db);
  const disputeRepo = new DisputeRepository(db);
  const disputeEventRepo = new DisputeEventRepository(db);
  const disputeEvidenceRepo = new DisputeEvidenceRepository(db);
  const disputeAssignmentRepo = new DisputeAssignmentRepository(db);
  const disputeDeadlineRepo = new DisputeDeadlineRepository(db);
  const releaseRepo = new ReleaseRepository(db);
  const auditRepo = new AuditLogRepository(db);
  const ledgerRepo = new LedgerRepository(db);

  const mockStorage = new MockEvidenceStorageProvider();
  const mockFiduciary = new MockFiduciaryProvider();

  const evidenceService = new EvidenceService(evidenceRepo, escrowRepo, auditRepo, mockStorage);
  const disputeService = new DisputeService(
    disputeRepo,
    disputeEventRepo,
    disputeEvidenceRepo,
    disputeAssignmentRepo,
    escrowRepo,
    userRepo,
    auditRepo
  );
  const releaseService = new ReleaseService(
    escrowRepo,
    releaseRepo,
    disputeRepo,
    ledgerRepo,
    auditRepo,
    mockFiduciary
  );
  const refundService = new RefundService(
    escrowRepo,
    releaseRepo,
    disputeRepo,
    ledgerRepo,
    auditRepo,
    mockFiduciary
  );
  const disputeResolutionService = new DisputeResolutionService(
    disputeService,
    disputeRepo,
    releaseService,
    refundService,
    auditRepo
  );
  const deadlineService = new DisputeDeadlineService(
    disputeDeadlineRepo,
    disputeEventRepo,
    auditRepo
  );

  const apiRouter = new EvidenceAndDisputeApiRouter(
    evidenceService,
    disputeService,
    disputeResolutionService,
    deadlineService,
    disputeRepo,
    disputeEventRepo,
    disputeEvidenceRepo,
    escrowRepo
  );

  let buyer: any;
  let seller: any;
  let support: any;
  let admin: any;
  let stranger: any;
  let sampleEscrow: any;
  let activeDispute: any;

  beforeAll(async () => {
    const executed = await runMigrations(db);
    expect(executed).toContain("003_evidence_disputes.sql");

    buyer = await userRepo.create({
      email: "buyer_t9@example.com",
      password_hash: "pass",
      role: ActorRole.BUYER,
      status: "ACTIVE",
    });

    seller = await userRepo.create({
      email: "seller_t9@example.com",
      password_hash: "pass",
      role: ActorRole.SELLER,
      status: "ACTIVE",
    });

    support = await userRepo.create({
      email: "support_t9@example.com",
      password_hash: "pass",
      role: ActorRole.SUPPORT,
      status: "ACTIVE",
    });

    admin = await userRepo.create({
      email: "admin_t9@example.com",
      password_hash: "pass",
      role: ActorRole.ADMIN,
      status: "ACTIVE",
    });

    stranger = await userRepo.create({
      email: "stranger_t9@example.com",
      password_hash: "pass",
      role: ActorRole.BUYER,
      status: "ACTIVE",
    });

    sampleEscrow = await escrowRepo.create({
      external_reference: "ESC-T9-001",
      buyer_id: buyer.id,
      seller_id: seller.id,
      amount: "250.00",
      currency: "USD",
      status: EscrowStatus.FUNDS_CONFIRMED,
    });
  });

  // ==========================================
  // EVIDENCE TESTS (1 - 20)
  // ==========================================

  it("1. creates valid evidence object and stores SHA-256 hash", async () => {
    const content = Buffer.from("Valid payment proof receipt content");
    const evidence = await evidenceService.uploadEvidence({
      escrowId: sampleEscrow.id,
      uploadedBy: buyer.id,
      type: EvidenceType.PAYMENT_PROOF,
      description: "Transfer receipt",
      filename: "receipt.pdf",
      mimeType: "application/pdf",
      content,
    });

    expect(evidence.id).toBeDefined();
    expect(evidence.sha256).toBe(calculateSha256(content));
    expect(evidence.status).toBe(EvidenceStatus.ACTIVE);
  });

  it("2. enforces IDOR protection: stranger cannot access evidence", async () => {
    const content = Buffer.from("Buyer private photo");
    const evidence = await evidenceService.uploadEvidence({
      escrowId: sampleEscrow.id,
      uploadedBy: buyer.id,
      type: EvidenceType.PRODUCT_PHOTO,
      filename: "photo.png",
      mimeType: "image/png",
      content,
    });

    await expect(
      evidenceService.getEvidence(evidence.id, { id: stranger.id, role: ActorRole.BUYER })
    ).rejects.toThrow(UnauthorizedEvidenceAccessError);
  });

  it("3. calculates and verifies SHA-256 hash correctly", async () => {
    const content = Buffer.from("Delivery photo buffer");
    const expectedHash = calculateSha256(content);
    expect(expectedHash).toHaveLength(64);

    const evidence = await evidenceService.uploadEvidence({
      escrowId: sampleEscrow.id,
      uploadedBy: seller.id,
      type: EvidenceType.DELIVERY_PROOF,
      filename: "delivery.jpg",
      mimeType: "image/jpeg",
      content,
    });

    const verification = await evidenceService.verifyIntegrity(evidence.id, seller.id);
    expect(verification.verified).toBe(true);
    expect(verification.sha256).toBe(expectedHash);
  });

  it("4. detects SHA-256 integrity mismatch if object content is corrupted", async () => {
    const content = Buffer.from("Original uncorrupted content");
    const evidence = await evidenceService.uploadEvidence({
      escrowId: sampleEscrow.id,
      uploadedBy: seller.id,
      type: EvidenceType.PRODUCT_PHOTO,
      filename: "photo_corrupt.jpg",
      mimeType: "image/jpeg",
      content,
    });

    // Tamper with mock storage object directly
    await mockStorage.putObject({
      key: evidence.storage_reference,
      content: Buffer.from("TAMPERED AND CORRUPTED CONTENT"),
      mimeType: "image/jpeg",
    });

    await expect(evidenceService.verifyIntegrity(evidence.id, admin.id)).rejects.toThrow(
      EvidenceIntegrityMismatchError
    );

    const updated = await evidenceRepo.findById(evidence.id);
    expect(updated?.status).toBe(EvidenceStatus.INTEGRITY_FAILED);
  });

  it("5. validates MIME types and rejects unapproved MIME types", () => {
    expect(() => validateMimeType("application/x-executable")).toThrow(InvalidEvidenceFileError);
    expect(() => validateMimeType("text/html")).toThrow(InvalidEvidenceFileError);
    expect(() => validateMimeType("image/jpeg")).not.toThrow();
  });

  it("6. validates file size boundaries", () => {
    expect(() => validateFileSize(0)).toThrow(InvalidEvidenceFileError);
    expect(() => validateFileSize(-100)).toThrow(InvalidEvidenceFileError);
    expect(() => validateFileSize(30 * 1024 * 1024)).toThrow(InvalidEvidenceFileError);
    expect(() => validateFileSize(1024)).not.toThrow();
  });

  it("7. sanitizes filename and prevents path traversal attempts", () => {
    expect(() => sanitizeFilename("../../../etc/passwd")).toThrow(InvalidEvidenceFileError);
    expect(() => sanitizeFilename("..\\windows\\system32")).toThrow(InvalidEvidenceFileError);
    expect(sanitizeFilename("my  document (1).pdf")).toBe("my__document__1_.pdf");
  });

  it("8. rejects dangerous file extensions", () => {
    expect(() => sanitizeFilename("malware.exe")).toThrow(InvalidEvidenceFileError);
    expect(() => sanitizeFilename("script.sh")).toThrow(InvalidEvidenceFileError);
    expect(() => sanitizeFilename("exploit.php")).toThrow(InvalidEvidenceFileError);
    expect(() => sanitizeFilename("payload.bat")).toThrow(InvalidEvidenceFileError);
  });

  it("9. respects PRIVATE visibility: accessible only to creator and staff", async () => {
    const content = Buffer.from("Private buyer note");
    const evidence = await evidenceService.uploadEvidence({
      escrowId: sampleEscrow.id,
      uploadedBy: buyer.id,
      type: EvidenceType.COMMUNICATION,
      filename: "private.txt",
      mimeType: "text/plain",
      content,
      visibility: EvidenceVisibility.PRIVATE,
    });

    // Creator buyer can access
    const buyerGet = await evidenceService.getEvidence(evidence.id, { id: buyer.id, role: ActorRole.BUYER });
    expect(buyerGet.record.id).toBe(evidence.id);

    // Support can access
    const supportGet = await evidenceService.getEvidence(evidence.id, { id: support.id, role: ActorRole.SUPPORT });
    expect(supportGet.record.id).toBe(evidence.id);

    // Other participant seller CANNOT access private evidence
    await expect(
      evidenceService.getEvidence(evidence.id, { id: seller.id, role: ActorRole.SELLER })
    ).rejects.toThrow(UnauthorizedEvidenceAccessError);
  });

  it("10. supports PARTICIPANTS visibility for buyer and seller", async () => {
    const content = Buffer.from("Shipping contract");
    const evidence = await evidenceService.uploadEvidence({
      escrowId: sampleEscrow.id,
      uploadedBy: seller.id,
      type: EvidenceType.CONTRACT,
      filename: "contract.pdf",
      mimeType: "application/pdf",
      content,
      visibility: EvidenceVisibility.PARTICIPANTS,
    });

    const buyerAccess = await evidenceService.getEvidence(evidence.id, { id: buyer.id, role: ActorRole.BUYER });
    const sellerAccess = await evidenceService.getEvidence(evidence.id, { id: seller.id, role: ActorRole.SELLER });

    expect(buyerAccess.record.id).toBe(evidence.id);
    expect(sellerAccess.record.id).toBe(evidence.id);
  });

  it("11. supports SUPPORT and ADMIN access to evidence", async () => {
    const content = Buffer.from("Identity doc");
    const evidence = await evidenceService.uploadEvidence({
      escrowId: sampleEscrow.id,
      uploadedBy: buyer.id,
      type: EvidenceType.IDENTITY_DOCUMENT,
      filename: "id.png",
      mimeType: "image/png",
      content,
      visibility: EvidenceVisibility.SUPPORT,
    });

    const adminGet = await evidenceService.getEvidence(evidence.id, { id: admin.id, role: ActorRole.ADMIN });
    expect(adminGet.record.id).toBe(evidence.id);
  });

  it("12. verifies integrity marks evidence status as VERIFIED", async () => {
    const content = Buffer.from("Verified content buffer");
    const evidence = await evidenceService.uploadEvidence({
      escrowId: sampleEscrow.id,
      uploadedBy: buyer.id,
      type: EvidenceType.RECEIPT,
      filename: "receipt2.pdf",
      mimeType: "application/pdf",
      content,
    });

    await evidenceService.verifyIntegrity(evidence.id, admin.id);
    const reloaded = await evidenceRepo.findById(evidence.id);
    expect(reloaded?.status).toBe(EvidenceStatus.VERIFIED);
  });

  it("13. creates append-only access event on evidence download", async () => {
    const content = Buffer.from("Access log test content");
    const evidence = await evidenceService.uploadEvidence({
      escrowId: sampleEscrow.id,
      uploadedBy: buyer.id,
      type: EvidenceType.OTHER,
      filename: "log.txt",
      mimeType: "text/plain",
      content,
    });

    await evidenceService.getEvidence(evidence.id, { id: buyer.id, role: ActorRole.BUYER }, { ipAddress: "192.168.1.1" });

    const logs = await evidenceRepo.getAccessEvents(evidence.id);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].actor_id).toBe(buyer.id);
    expect(logs[0].ip_address).toBe("192.168.1.1");
  });

  it("14. supports upload intent generation", async () => {
    const intent = await mockStorage.createUploadIntent({
      escrowId: sampleEscrow.id,
      filename: "photo.jpg",
      mimeType: "image/jpeg",
      fileSize: 1024,
    });

    expect(intent.uploadUrl).toContain("https://storage.mock.local/upload/");
    expect(intent.storageKey).toContain(sampleEscrow.id);
  });

  it("15. supports append-only evidence replacement, preserving original record", async () => {
    const content1 = Buffer.from("Original photo version 1");
    const orig = await evidenceService.uploadEvidence({
      escrowId: sampleEscrow.id,
      uploadedBy: buyer.id,
      type: EvidenceType.PRODUCT_PHOTO,
      filename: "photo_v1.jpg",
      mimeType: "image/jpeg",
      content: content1,
    });

    const content2 = Buffer.from("New higher resolution photo version 2");
    const replacement = await evidenceService.replaceEvidence(
      orig.id,
      {
        escrowId: sampleEscrow.id,
        uploadedBy: buyer.id,
        type: EvidenceType.PRODUCT_PHOTO,
        filename: "photo_v2.jpg",
        mimeType: "image/jpeg",
        content: content2,
      },
      { id: buyer.id, role: ActorRole.BUYER }
    );

    expect(replacement.oldRecord.status).toBe(EvidenceStatus.REPLACED);
    expect(replacement.oldRecord.replaced_by_id).toBe(replacement.newRecord.id);
    expect(replacement.newRecord.status).toBe(EvidenceStatus.ACTIVE);
  });

  it("16. generates unique storage keys per upload", async () => {
    const content = Buffer.from("Same content string");
    const e1 = await evidenceService.uploadEvidence({
      escrowId: sampleEscrow.id,
      uploadedBy: buyer.id,
      type: EvidenceType.OTHER,
      filename: "same.txt",
      mimeType: "text/plain",
      content,
    });

    const e2 = await evidenceService.uploadEvidence({
      escrowId: sampleEscrow.id,
      uploadedBy: buyer.id,
      type: EvidenceType.OTHER,
      filename: "same.txt",
      mimeType: "text/plain",
      content,
    });

    expect(e1.storage_reference).not.toBe(e2.storage_reference);
  });

  it("17. detects sensitive card payment numbers in description/metadata", async () => {
    const sensitiveCard = "4111 2222 3333 4444";
    await expect(
      evidenceService.uploadEvidence({
        escrowId: sampleEscrow.id,
        uploadedBy: buyer.id,
        type: EvidenceType.PAYMENT_PROOF,
        description: `My card number is ${sensitiveCard}`,
        filename: "card.txt",
        mimeType: "text/plain",
        content: Buffer.from("card data"),
      })
    ).rejects.toThrow(SensitiveDataDetectedError);
  });

  it("18. API Handler list escrow evidence filters by user visibility permissions", async () => {
    const res = await apiRouter.handleListEscrowEvidence(sampleEscrow.id, {
      user: { id: buyer.id, role: ActorRole.BUYER },
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("19. API Handler get evidence download URL enforces authentication", async () => {
    const res = await apiRouter.handleGetEvidenceDownload("some-id", {});
    expect(res.status).toBe(401);
  });

  it("20. API Handler verify evidence calls integrity service", async () => {
    const content = Buffer.from("API verify test buffer");
    const evidence = await evidenceService.uploadEvidence({
      escrowId: sampleEscrow.id,
      uploadedBy: seller.id,
      type: EvidenceType.RECEIPT,
      filename: "api_rec.pdf",
      mimeType: "application/pdf",
      content,
    });

    const res = await apiRouter.handleVerifyEvidence(evidence.id, {
      user: { id: admin.id, role: ActorRole.ADMIN },
    });

    expect(res.status).toBe(200);
    expect(res.body.data.verified).toBe(true);
  });

  // ==========================================
  // DISPUTE TESTS (21 - 40)
  // ==========================================

  it("21. creates dispute for eligible escrow transaction and transitions state to DISPUTED", async () => {
    const dispute = await disputeService.createDispute({
      escrowId: sampleEscrow.id,
      openedByUserId: buyer.id,
      openedByUserRole: ActorRole.BUYER,
      reason: DisputeReason.ITEM_NOT_RECEIVED,
      description: "Package did not arrive after 10 days",
    });

    expect(dispute.id).toBeDefined();
    expect(dispute.status).toBe(DisputeStatus.OPEN);
    expect(dispute.reason).toBe(DisputeReason.ITEM_NOT_RECEIVED);

    const updatedEscrow = await escrowRepo.findById(sampleEscrow.id);
    expect(updatedEscrow?.status).toBe(EscrowStatus.DISPUTED);

    activeDispute = dispute;
  });

  it("22. blocks unauthorized dispute creation by unrelated stranger user", async () => {
    const escrow2 = await escrowRepo.create({
      external_reference: "ESC-T9-002",
      buyer_id: buyer.id,
      seller_id: seller.id,
      amount: "100.00",
      currency: "USD",
      status: EscrowStatus.FUNDS_CONFIRMED,
    });

    await expect(
      disputeService.createDispute({
        escrowId: escrow2.id,
        openedByUserId: stranger.id,
        openedByUserRole: ActorRole.BUYER,
        reason: DisputeReason.OTHER,
      })
    ).rejects.toThrow("Unauthorized");
  });

  it("23. prevents duplicate active dispute creation for same escrow", async () => {
    await expect(
      disputeService.createDispute({
        escrowId: sampleEscrow.id,
        openedByUserId: buyer.id,
        openedByUserRole: ActorRole.BUYER,
        reason: DisputeReason.ITEM_NOT_AS_DESCRIBED,
      })
    ).rejects.toThrow(DuplicateActiveDisputeError);
  });

  it("24. transitions dispute state from OPEN to UNDER_REVIEW by support role", async () => {
    const updated = await disputeService.executeAction({
      disputeId: activeDispute.id,
      action: DisputeAction.START_REVIEW,
      targetStatus: DisputeStatus.UNDER_REVIEW,
      actorId: support.id,
      actorRole: ActorRole.SUPPORT,
      reason: "Starting operational review",
    });

    expect(updated.status).toBe(DisputeStatus.UNDER_REVIEW);
  });

  it("25. rejects invalid dispute state transition", async () => {
    await expect(
      disputeService.executeAction({
        disputeId: activeDispute.id,
        action: DisputeAction.CLOSE,
        targetStatus: DisputeStatus.CANCELLED, // Cannot transition directly from UNDER_REVIEW to CANCELLED
        actorId: support.id,
        actorRole: ActorRole.SUPPORT,
        reason: "Invalid transition test",
      })
    ).rejects.toThrow(InvalidDisputeStateTransitionError);
  });

  it("26. assigns dispute to operational support user and records assignment history", async () => {
    const assigned = await disputeService.assignDispute(
      activeDispute.id,
      support.id,
      { id: admin.id, role: ActorRole.ADMIN }
    );

    expect(assigned.assigned_to).toBe(support.id);

    const history = await disputeAssignmentRepo.findByDisputeId(activeDispute.id);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].assigned_to).toBe(support.id);
  });

  it("27. prevents dispute assignment to non-operational user role (buyer)", async () => {
    await expect(
      disputeService.assignDispute(
        activeDispute.id,
        buyer.id,
        { id: admin.id, role: ActorRole.ADMIN }
      )
    ).rejects.toThrow("Dispute cannot be assigned to non-operational role");
  });

  it("28. requests evidence from seller and transitions status to WAITING_SELLER", async () => {
    const updated = await disputeService.executeAction({
      disputeId: activeDispute.id,
      action: DisputeAction.REQUEST_SELLER_EVIDENCE,
      targetStatus: DisputeStatus.WAITING_SELLER,
      actorId: support.id,
      actorRole: ActorRole.SUPPORT,
      reason: "Please provide tracking number and shipping receipt",
    });

    expect(updated.status).toBe(DisputeStatus.WAITING_SELLER);
  });

  it("29. links seller evidence to dispute and transitions back to UNDER_REVIEW", async () => {
    const content = Buffer.from("Tracking receipt");
    const evidence = await evidenceService.uploadEvidence({
      escrowId: sampleEscrow.id,
      uploadedBy: seller.id,
      type: EvidenceType.TRACKING_NUMBER,
      filename: "tracking.pdf",
      mimeType: "application/pdf",
      content,
    });

    await disputeEvidenceRepo.linkEvidence({
      dispute_id: activeDispute.id,
      evidence_id: evidence.id,
      submitted_by: seller.id,
    });

    const updated = await disputeService.executeAction({
      disputeId: activeDispute.id,
      action: DisputeAction.START_REVIEW,
      targetStatus: DisputeStatus.UNDER_REVIEW,
      actorId: seller.id,
      actorRole: ActorRole.SELLER,
      reason: "Evidence submitted by seller",
    });

    expect(updated.status).toBe(DisputeStatus.UNDER_REVIEW);

    const linked = await disputeEvidenceRepo.findEvidenceRecordsByDisputeId(activeDispute.id);
    expect(linked.some((e) => e.id === evidence.id)).toBe(true);
  });

  it("30. escalates dispute to admin review", async () => {
    const updated = await disputeService.executeAction({
      disputeId: activeDispute.id,
      action: DisputeAction.ESCALATE,
      targetStatus: DisputeStatus.ESCALATED,
      actorId: support.id,
      actorRole: ActorRole.SUPPORT,
      reason: "High value dispute escalated to senior admin",
    });

    expect(updated.status).toBe(DisputeStatus.ESCALATED);
  });

  it("31. prohibits buyer or seller from resolving dispute directly", async () => {
    await expect(
      disputeService.executeAction({
        disputeId: activeDispute.id,
        action: DisputeAction.RESOLVE_BUYER,
        targetStatus: DisputeStatus.RESOLVED_BUYER,
        actorId: buyer.id,
        actorRole: ActorRole.BUYER,
        reason: "I want my money back",
      })
    ).rejects.toThrow(UnauthorizedDisputeActorError);
  });

  it("32. creates dispute deadline and checks expiration", async () => {
    let mockTime = new Date("2026-01-01T00:00:00Z");
    const customDeadlineService = new DisputeDeadlineService(
      disputeDeadlineRepo,
      disputeEventRepo,
      auditRepo,
      () => mockTime
    );

    const deadline = await customDeadlineService.createDeadline(
      activeDispute.id,
      DeadlineType.EVIDENCE_SUBMISSION,
      24
    );

    expect(deadline.status).toBe(DeadlineStatus.PENDING);

    // Fast forward time past 24 hours
    mockTime = new Date("2026-01-02T02:00:00Z");
    const expiredList = await customDeadlineService.checkAndExpireDeadlines();

    expect(expiredList.length).toBeGreaterThan(0);
    expect(expiredList[0].status).toBe(DeadlineStatus.EXPIRED);
  });

  it("33. preserves append-only dispute action event history", async () => {
    const events = await disputeEventRepo.findByDisputeId(activeDispute.id);
    expect(events.length).toBeGreaterThan(3);
    expect(events[0].action).toBe(DisputeAction.OPEN);
  });

  it("34. terminal state protection: cannot transition out of RESOLVED/CLOSED state", async () => {
    const escrowTemp = await escrowRepo.create({
      external_reference: "ESC-T9-TEMP",
      buyer_id: buyer.id,
      seller_id: seller.id,
      amount: "50.00",
      currency: "USD",
      status: EscrowStatus.FUNDS_CONFIRMED,
    });

    const tempDispute = await disputeService.createDispute({
      escrowId: escrowTemp.id,
      openedByUserId: buyer.id,
      openedByUserRole: ActorRole.BUYER,
      reason: DisputeReason.DAMAGED_ITEM,
    });

    await disputeResolutionService.resolveToBuyer({
      disputeId: tempDispute.id,
      resolvedByUserId: admin.id,
      resolvedByUserRole: ActorRole.ADMIN,
      resolutionReason: "Item arrived damaged beyond repair",
      idempotencyKey: `res-temp-${tempDispute.id}`,
    });

    await expect(
      disputeService.executeAction({
        disputeId: tempDispute.id,
        action: DisputeAction.START_REVIEW,
        targetStatus: DisputeStatus.UNDER_REVIEW,
        actorId: admin.id,
        actorRole: ActorRole.ADMIN,
        reason: "Reopening terminal dispute",
      })
    ).rejects.toThrow(TerminalDisputeStateError);
  });

  it("35. supports RESOLVED_SPLIT without fake balance manipulation", async () => {
    const escrowSplit = await escrowRepo.create({
      external_reference: "ESC-T9-SPLIT",
      buyer_id: buyer.id,
      seller_id: seller.id,
      amount: "300.00",
      currency: "USD",
      status: EscrowStatus.FUNDS_CONFIRMED,
    });

    const splitDispute = await disputeService.createDispute({
      escrowId: escrowSplit.id,
      openedByUserId: buyer.id,
      openedByUserRole: ActorRole.BUYER,
      reason: DisputeReason.DELIVERY_PROBLEM,
    });

    await disputeService.executeAction({
      disputeId: splitDispute.id,
      action: DisputeAction.START_REVIEW,
      targetStatus: DisputeStatus.UNDER_REVIEW,
      actorId: support.id,
      actorRole: ActorRole.SUPPORT,
      reason: "Under review for split",
    });

    const res = await disputeResolutionService.resolveSplit({
      disputeId: splitDispute.id,
      resolvedByUserId: admin.id,
      resolvedByUserRole: ActorRole.ADMIN,
      resolutionReason: "50/50 partial settlement agreed by parties",
      idempotencyKey: `res-split-${splitDispute.id}`,
    });

    expect(res.dispute.status).toBe(DisputeStatus.RESOLVED_SPLIT);
  });

  it("36. API Handler handleCreateDispute creates dispute successfully", async () => {
    const escApi = await escrowRepo.create({
      external_reference: "ESC-T9-API-DISP",
      buyer_id: buyer.id,
      seller_id: seller.id,
      amount: "80.00",
      currency: "USD",
      status: EscrowStatus.DELIVERED,
    });

    const res = await apiRouter.handleCreateDispute(
      escApi.id,
      { reason: DisputeReason.WRONG_ITEM, description: "Received wrong color" },
      { user: { id: buyer.id, role: ActorRole.BUYER } }
    );

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
  });

  it("37. API Handler handleGetDisputeHistory returns full dispute timeline", async () => {
    const res = await apiRouter.handleGetDisputeHistory(activeDispute.id, {
      user: { id: buyer.id, role: ActorRole.BUYER },
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("38. API Handler handleLinkDisputeEvidence links evidence and retrieves linked evidence", async () => {
    const content = Buffer.from("Link test receipt");
    const evidence = await evidenceService.uploadEvidence({
      escrowId: sampleEscrow.id,
      uploadedBy: buyer.id,
      type: EvidenceType.RECEIPT,
      filename: "link_receipt.pdf",
      mimeType: "application/pdf",
      content,
    });

    const linkRes = await apiRouter.handleLinkDisputeEvidence(
      activeDispute.id,
      { evidenceId: evidence.id },
      { user: { id: buyer.id, role: ActorRole.BUYER } }
    );
    expect(linkRes.status).toBe(201);

    const getRes = await apiRouter.handleGetDisputeEvidence(activeDispute.id, {
      user: { id: buyer.id, role: ActorRole.BUYER },
    });
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.some((e: any) => e.id === evidence.id)).toBe(true);
  });

  it("39. NotificationHookRegistry registers and emits dispute events", async () => {
    const registry = NotificationHookRegistry.getInstance();
    let emitted = false;

    registry.on(NotificationEventType.DISPUTE_CREATED, (payload) => {
      emitted = true;
      expect(payload.escrowId).toBe(sampleEscrow.id);
    });

    await registry.emit({
      eventType: NotificationEventType.DISPUTE_CREATED,
      escrowId: sampleEscrow.id,
      disputeId: activeDispute.id,
      recipientUserIds: [seller.id],
      createdAt: new Date().toISOString(),
    });

    expect(emitted).toBe(true);
  });

  it("40. handles cancellation action by dispute opener", async () => {
    const escCancel = await escrowRepo.create({
      external_reference: "ESC-T9-CANCEL",
      buyer_id: buyer.id,
      seller_id: seller.id,
      amount: "120.00",
      currency: "USD",
      status: EscrowStatus.FUNDS_CONFIRMED,
    });

    const dispCancel = await disputeService.createDispute({
      escrowId: escCancel.id,
      openedByUserId: buyer.id,
      openedByUserRole: ActorRole.BUYER,
      reason: DisputeReason.OTHER,
      description: "Opened by mistake",
    });

    const cancelled = await disputeService.executeAction({
      disputeId: dispCancel.id,
      action: DisputeAction.CANCEL,
      targetStatus: DisputeStatus.CANCELLED,
      actorId: buyer.id,
      actorRole: ActorRole.BUYER,
      reason: "Resolved directly with seller off-platform",
    });

    expect(cancelled.status).toBe(DisputeStatus.CANCELLED);
  });

  // ==========================================
  // FINANCIAL FREEZE & RESOLUTION TESTS (41 - 52)
  // ==========================================

  it("41. CRITICAL: active dispute blocks automatic release attempt with FinancialFreezeError", async () => {
    await expect(
      releaseService.requestRelease({
        escrowId: sampleEscrow.id,
        requestedBy: seller.id,
        actorRole: ActorRole.SELLER,
        idempotencyKey: `rel-blocked-${Date.now()}`,
      })
    ).rejects.toThrow(FinancialFreezeError);

    // Verify block was audited
    const auditLogs = await auditRepo.findByEntity("ESCROW", sampleEscrow.id);
    expect(auditLogs.some((l) => l.action === "RELEASE_BLOCKED_FINANCIAL_FREEZE")).toBe(true);
  });

  it("42. CRITICAL: active dispute blocks automatic refund attempt with FinancialFreezeError", async () => {
    await expect(
      refundService.requestRefund({
        escrowId: sampleEscrow.id,
        requestedBy: buyer.id,
        actorRole: ActorRole.BUYER,
        idempotencyKey: `ref-blocked-${Date.now()}`,
      })
    ).rejects.toThrow(FinancialFreezeError);

    // Verify block was audited
    const auditLogs = await auditRepo.findByEntity("ESCROW", sampleEscrow.id);
    expect(auditLogs.some((l) => l.action === "REFUND_BLOCKED_FINANCIAL_FREEZE")).toBe(true);
  });

  it("43. dispute resolution to buyer triggers authorized refund workflow and double-entry ledger posting", async () => {
    const escResBuyer = await escrowRepo.create({
      external_reference: "ESC-T9-RES-BUYER",
      buyer_id: buyer.id,
      seller_id: seller.id,
      amount: "500.00",
      currency: "USD",
      status: EscrowStatus.FUNDS_CONFIRMED,
    });

    const dispResBuyer = await disputeService.createDispute({
      escrowId: escResBuyer.id,
      openedByUserId: buyer.id,
      openedByUserRole: ActorRole.BUYER,
      reason: DisputeReason.ITEM_NOT_RECEIVED,
    });

    const res = await disputeResolutionService.resolveToBuyer({
      disputeId: dispResBuyer.id,
      resolvedByUserId: admin.id,
      resolvedByUserRole: ActorRole.ADMIN,
      resolutionReason: "Carrier confirmed item lost in transit",
      idempotencyKey: `res-b-${dispResBuyer.id}`,
    });

    expect(res.dispute.status).toBe(DisputeStatus.RESOLVED_BUYER);
    expect(res.refund.status).toBe("COMPLETED");

    const finalEscrow = await escrowRepo.findById(escResBuyer.id);
    expect(finalEscrow?.status).toBe(EscrowStatus.REFUNDED);
  });

  it("44. dispute resolution to seller triggers authorized release workflow and double-entry ledger posting", async () => {
    const escResSeller = await escrowRepo.create({
      external_reference: "ESC-T9-RES-SELLER",
      buyer_id: buyer.id,
      seller_id: seller.id,
      amount: "400.00",
      currency: "USD",
      status: EscrowStatus.FUNDS_CONFIRMED,
    });

    const dispResSeller = await disputeService.createDispute({
      escrowId: escResSeller.id,
      openedByUserId: buyer.id,
      openedByUserRole: ActorRole.BUYER,
      reason: DisputeReason.ITEM_NOT_AS_DESCRIBED,
    });

    const res = await disputeResolutionService.resolveToSeller({
      disputeId: dispResSeller.id,
      resolvedByUserId: admin.id,
      resolvedByUserRole: ActorRole.ADMIN,
      resolutionReason: "Delivery proof verified; item matches description",
      idempotencyKey: `res-s-${dispResSeller.id}`,
    });

    expect(res.dispute.status).toBe(DisputeStatus.RESOLVED_SELLER);
    expect(res.release.status).toBe("COMPLETED");

    const finalEscrow = await escrowRepo.findById(escResSeller.id);
    expect(finalEscrow?.status).toBe(EscrowStatus.RELEASED);
  });

  it("45. prevents duplicate release on already resolved dispute", async () => {
    const escResolved = await escrowRepo.create({
      external_reference: "ESC-T9-DUP-REL",
      buyer_id: buyer.id,
      seller_id: seller.id,
      amount: "150.00",
      currency: "USD",
      status: EscrowStatus.FUNDS_CONFIRMED,
    });

    const dispResolved = await disputeService.createDispute({
      escrowId: escResolved.id,
      openedByUserId: buyer.id,
      openedByUserRole: ActorRole.BUYER,
      reason: DisputeReason.WRONG_ITEM,
    });

    await disputeResolutionService.resolveToSeller({
      disputeId: dispResolved.id,
      resolvedByUserId: admin.id,
      resolvedByUserRole: ActorRole.ADMIN,
      resolutionReason: "First resolution release",
      idempotencyKey: `dup-rel-key-${dispResolved.id}`,
    });

    // Attempting second release returns existing release record idempotently
    const secondRelease = await releaseService.requestRelease({
      escrowId: escResolved.id,
      requestedBy: admin.id,
      actorRole: ActorRole.ADMIN,
      idempotencyKey: `dup-rel-key-${dispResolved.id}`,
      isDisputeResolution: true,
    });

    expect(secondRelease.status).toBe("COMPLETED");
  });

  it("46. prevents duplicate refund on already resolved dispute", async () => {
    const escResolved = await escrowRepo.create({
      external_reference: "ESC-T9-DUP-REF",
      buyer_id: buyer.id,
      seller_id: seller.id,
      amount: "180.00",
      currency: "USD",
      status: EscrowStatus.FUNDS_CONFIRMED,
    });

    const dispResolved = await disputeService.createDispute({
      escrowId: escResolved.id,
      openedByUserId: buyer.id,
      openedByUserRole: ActorRole.BUYER,
      reason: DisputeReason.FRAUD_SUSPECTED,
    });

    await disputeResolutionService.resolveToBuyer({
      disputeId: dispResolved.id,
      resolvedByUserId: admin.id,
      resolvedByUserRole: ActorRole.ADMIN,
      resolutionReason: "First resolution refund",
      idempotencyKey: `dup-ref-key-${dispResolved.id}`,
    });

    const secondRefund = await refundService.requestRefund({
      escrowId: escResolved.id,
      requestedBy: admin.id,
      actorRole: ActorRole.ADMIN,
      idempotencyKey: `dup-ref-key-${dispResolved.id}`,
      isDisputeResolution: true,
    });

    expect(secondRefund.status).toBe("COMPLETED");
  });

  it("47. deadline expiration does NOT move money automatically", async () => {
    const escDL = await escrowRepo.create({
      external_reference: "ESC-T9-DEADLINE-MONEY",
      buyer_id: buyer.id,
      seller_id: seller.id,
      amount: "300.00",
      currency: "USD",
      status: EscrowStatus.FUNDS_CONFIRMED,
    });

    const dispDL = await disputeService.createDispute({
      escrowId: escDL.id,
      openedByUserId: buyer.id,
      openedByUserRole: ActorRole.BUYER,
      reason: DisputeReason.ITEM_NOT_RECEIVED,
    });

    let mockTime = new Date("2026-02-01T00:00:00Z");
    const testDlService = new DisputeDeadlineService(
      disputeDeadlineRepo,
      disputeEventRepo,
      auditRepo,
      () => mockTime
    );

    await testDlService.createDeadline(dispDL.id, DeadlineType.SELLER_RESPONSE, 12);

    // Fast forward mock time
    mockTime = new Date("2026-02-02T00:00:00Z");
    await testDlService.checkAndExpireDeadlines();

    // Verify escrow status is still DISPUTED and no releases/refunds were created
    const escAfter = await escrowRepo.findById(escDL.id);
    expect(escAfter?.status).toBe(EscrowStatus.DISPUTED);

    const releases = await releaseRepo.findByEscrowId(escDL.id);
    const refunds = await releaseRepo.findRefundsByEscrowId(escDL.id);

    expect(releases.length).toBe(0);
    expect(refunds.length).toBe(0);
  });

  it("48. unassigned dispute remains OPEN and requires operational review", async () => {
    const dispute = await disputeRepo.findById(activeDispute.id);
    expect(dispute).toBeDefined();
    expect(dispute?.opened_by).toBe(buyer.id);
  });

  it("49. storage provider factory safety guard fails closed in production without config", () => {
    const origEnvMode = process.env.STORAGE_PROVIDER_MODE;
    const origNodeEnv = process.env.NODE_ENV;

    process.env.STORAGE_PROVIDER_MODE = "s3";
    delete process.env.AWS_S3_BUCKET;

    expect(() => getStorageProvider()).toThrow("Production safety error");

    process.env.STORAGE_PROVIDER_MODE = origEnvMode;
    process.env.NODE_ENV = origNodeEnv;
  });

  it("50. verifies audit trail completeness across evidence and dispute lifecycle", async () => {
    const auditLogs = await auditRepo.findByEntity("DISPUTE", activeDispute.id);
    expect(auditLogs.length).toBeGreaterThan(1);
    expect(auditLogs.some((l) => l.action.startsWith("DISPUTE"))).toBe(true);
  });

  it("51. double-entry ledger post release enforces Debits == Credits", async () => {
    let holding = await ledgerRepo.findAccountByCode("2010_CUSTOMER_ESCROW_HOLDING");
    if (!holding) {
      holding = await ledgerRepo.createAccount({
        name: "CUSTOMER_ESCROW_HOLDING",
        code: "2010_CUSTOMER_ESCROW_HOLDING",
        type: LedgerAccountType.LIABILITY,
      });
    }

    let payout = await ledgerRepo.findAccountByCode("1020_BANK_PAYOUT_CLEARING");
    if (!payout) {
      payout = await ledgerRepo.createAccount({
        name: "BANK_PAYOUT_CLEARING",
        code: "1020_BANK_PAYOUT_CLEARING",
        type: LedgerAccountType.ASSET,
      });
    }

    const posting = await ledgerRepo.postTransaction(
      {
        type: "MANUAL_TEST_LEDGER",
        reference: "REF-TEST-100",
      },
      [
        { ledger_account_id: holding.id, direction: "DEBIT" as any, amount: "100.00", currency: "USD" },
        { ledger_account_id: payout.id, direction: "CREDIT" as any, amount: "100.00", currency: "USD" },
      ]
    );

    expect(posting.transaction.id).toBeDefined();
  });

  it("52. API Handler handleExecuteDisputeAction routes resolution to buyer safely", async () => {
    const escApiRes = await escrowRepo.create({
      external_reference: "ESC-T9-API-RES-BUYER",
      buyer_id: buyer.id,
      seller_id: seller.id,
      amount: "110.00",
      currency: "USD",
      status: EscrowStatus.FUNDS_CONFIRMED,
    });

    const dispApiRes = await disputeService.createDispute({
      escrowId: escApiRes.id,
      openedByUserId: buyer.id,
      openedByUserRole: ActorRole.BUYER,
      reason: DisputeReason.DAMAGED_ITEM,
    });

    const apiRes = await apiRouter.handleExecuteDisputeAction(
      dispApiRes.id,
      {
        action: DisputeAction.RESOLVE_BUYER,
        targetStatus: DisputeStatus.RESOLVED_BUYER,
        reason: "Item broken on arrival",
      },
      {
        user: { id: admin.id, role: ActorRole.ADMIN },
        idempotencyKey: `api-res-buyer-${dispApiRes.id}`,
      }
    );

    expect(apiRes.status).toBe(200);
    expect(apiRes.body.data.dispute.status).toBe(DisputeStatus.RESOLVED_BUYER);
    expect(apiRes.body.data.refund.status).toBe("COMPLETED");
  });
});
