import {
  VerificationRepository,
  WebhookEventRepository,
} from "@escrow-ecuador/database";
import {
  VerificationEventEmitter,
  VerificationEventType,
  VerificationStatus,
} from "@escrow-ecuador/domain";
import { CipherIdService } from "./cipherid.service.js";
import { CipherByteAuthError } from "./errors.js";

export interface CipherIdWebhookPayload {
  eventId: string;
  eventType: string;
  providerReference: string;
  escrowId?: string;
  partyId?: string;
  status: "COMPLETED" | "VERIFIED" | "FAILED" | "REJECTED";
  verifiedAt?: string;
  details?: Record<string, unknown>;
}

export interface HandleWebhookParams {
  rawBody: string;
  signatureHeader: string;
  payload: CipherIdWebhookPayload;
}

export class CipherIdWebhookController {
  constructor(
    private readonly cipherIdService: CipherIdService,
    private readonly verificationRepo: VerificationRepository,
    private readonly webhookRepo: WebhookEventRepository,
    private readonly eventEmitter: VerificationEventEmitter,
  ) {}

  async handleWebhook(
    params: HandleWebhookParams,
  ): Promise<{ status: string; eventId: string; processed: boolean }> {
    const { rawBody, signatureHeader, payload } = params;

    // 1. Signature Verification
    const isValidSignature = this.cipherIdService.verifyWebhookSignature(
      rawBody,
      signatureHeader,
    );
    if (!isValidSignature) {
      throw new CipherByteAuthError(
        "Invalid webhook signature from CipherID",
        401,
      );
    }

    // 2. Idempotency Check in Webhook Event Repository
    const eventId = payload.eventId || `evt_${payload.providerReference}`;
    try {
      await this.webhookRepo.recordEvent({
        provider: "CIPHERID",
        event_id: eventId,
        event_type: payload.eventType || "identity.verification.updated",
        payload: payload as unknown as Record<string, unknown>,
        signature_verified: true,
        status: "PROCESSED",
      });
    } catch (err: unknown) {
      // If UNIQUE(provider, event_id) constraint triggered, this event is a duplicate
      const msg = (err as Error)?.message?.toLowerCase() || "";
      if (
        msg.includes("unique") ||
        msg.includes("duplicate") ||
        msg.includes("uk_webhook_provider_event")
      ) {
        return { status: "IDEMPOTENT_IGNORE", eventId, processed: false };
      }
      throw err;
    }

    // 3. Find verification record in database
    const record = await this.verificationRepo.findByProviderReference(
      payload.providerReference,
    );
    if (!record) {
      return { status: "RECORD_NOT_FOUND", eventId, processed: true };
    }

    // Check if record is already in terminal state (idempotency on verification status)
    if (
      record.status === VerificationStatus.VERIFIED ||
      record.status === VerificationStatus.FAILED
    ) {
      return { status: "ALREADY_PROCESSED", eventId, processed: false };
    }

    // 4. Update status in database
    const isSuccess =
      payload.status === "VERIFIED" || payload.status === "COMPLETED";
    const newStatus = isSuccess
      ? VerificationStatus.VERIFIED
      : VerificationStatus.FAILED;
    const verifiedAt = payload.verifiedAt
      ? new Date(payload.verifiedAt)
      : new Date();

    await this.verificationRepo.updateStatus(
      record.id,
      newStatus,
      payload.providerReference,
      verifiedAt,
      payload as unknown as Record<string, unknown>,
    );

    // 5. Publish internal domain event
    const domainEventType = isSuccess
      ? VerificationEventType.IDENTITY_VERIFICATION_COMPLETED
      : VerificationEventType.IDENTITY_VERIFICATION_FAILED;

    await this.eventEmitter.emit({
      type: domainEventType,
      verificationId: record.id,
      escrowId: record.escrow_id ?? undefined,
      partyId: record.party_id ?? undefined,
      provider: "CIPHERID",
      timestamp: new Date(),
      payload: {
        status: newStatus,
        providerReference: payload.providerReference,
        details: payload.details,
      },
    });

    return { status: "PROCESSED", eventId, processed: true };
  }
}
