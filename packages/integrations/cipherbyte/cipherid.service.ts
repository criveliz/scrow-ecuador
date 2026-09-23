import {
  CreateIdentityVerificationInput,
  IdentityVerificationSession,
  VerificationStatus,
} from "@escrow-ecuador/domain";
import * as crypto from "crypto";

export interface CipherIdServiceConfig {
  baseUrl?: string;
  webhookSecret?: string;
}

export class CipherIdService {
  private readonly baseUrl: string;
  private readonly webhookSecret: string;

  constructor(config: CipherIdServiceConfig = {}) {
    this.baseUrl = (
      config.baseUrl ||
      process.env.CIPHERID_BASE_URL ||
      "https://verify.cipherid.ec"
    ).replace(/\/+$/, "");
    this.webhookSecret =
      config.webhookSecret || process.env.CIPHERID_WEBHOOK_SECRET || "";
  }

  /**
   * Creates an identity verification session for CipherID biometrics.
   * Production Note: In production, CipherByte will provide a dedicated CipherID session token endpoint
   * or API gateway URL. This adapter generates the verification session DTO and URL.
   */
  async createIdentityVerification(
    input: CreateIdentityVerificationInput,
  ): Promise<IdentityVerificationSession> {
    const sessionId = `cid_sess_${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours validity

    const verificationUrl = `${this.baseUrl}/session/${sessionId}?escrowId=${encodeURIComponent(
      input.escrowId,
    )}&partyId=${encodeURIComponent(input.partyId)}`;

    return {
      status: VerificationStatus.PENDING,
      verificationUrl,
      expiresAt,
      providerReference: sessionId,
    };
  }

  /**
   * Validates the webhook signature from CipherID callback.
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    if (!this.webhookSecret) {
      // If no secret configured in test/dev, permit unless explicit test header fails
      if (process.env.NODE_ENV === "production") {
        return false;
      }
      return (
        signatureHeader === "test-valid-signature" || Boolean(signatureHeader)
      );
    }

    try {
      const hmac = crypto.createHmac("sha256", this.webhookSecret);
      const computed = hmac.update(rawBody).digest("hex");
      return crypto.timingSafeEqual(
        Buffer.from(computed),
        Buffer.from(signatureHeader),
      );
    } catch {
      return false;
    }
  }
}
