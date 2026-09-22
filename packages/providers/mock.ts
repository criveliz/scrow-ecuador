import crypto from "crypto";
import type {
  EvidenceStorageProvider,
  FiduciaryProvider,
  PaymentProvider,
  StoredObjectResult,
  UploadIntentInput,
  UploadIntentResult,
} from "./interfaces.js";

export class MockPaymentProvider implements PaymentProvider {
  async createPaymentIntent(input: {
    escrowId: string;
    amount: string;
    currency: "USD";
    idempotencyKey: string;
  }) {
    return {
      providerReference: `mock-pay-${input.escrowId}`,
      amount: input.amount,
      currency: input.currency,
      status: "PENDING" as const,
      paymentUrl: `http://localhost:3000/pay/${input.escrowId}`,
    };
  }

  async verifyWebhook(input: { rawBody: string; signature: string }) {
    if (!input.signature) throw new Error("Missing mock webhook signature");
    return {
      eventId: `mock-event-${Date.now()}`,
      eventType: "payment.succeeded",
      payload: JSON.parse(input.rawBody),
    };
  }
}

export class MockFiduciaryProvider implements FiduciaryProvider {
  async verifyIncomingFunds() {
    return { confirmed: true, providerReference: "mock-funds-confirmed" };
  }

  async requestRelease(input: { escrowId: string; amount: string; idempotencyKey: string }) {
    return {
      providerReference: `mock-release-${input.escrowId}`,
      status: "COMPLETED" as const,
    };
  }

  async requestRefund(input: { escrowId: string; amount: string; idempotencyKey: string }) {
    return {
      providerReference: `mock-refund-${input.escrowId}`,
      status: "COMPLETED" as const,
    };
  }
}

export class MockEvidenceStorageProvider implements EvidenceStorageProvider {
  private readonly storage = new Map<string, { content: Buffer; mimeType: string }>();

  calculateHash(content: Buffer | Uint8Array): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  async createUploadIntent(input: UploadIntentInput): Promise<UploadIntentResult> {
    const key = `escrows/${input.escrowId}/${crypto.randomUUID()}-${input.filename}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    return {
      uploadUrl: `https://storage.mock.local/upload/${key}?expires=${expiresAt}`,
      storageKey: key,
      expiresAt,
    };
  }

  async putObject(input: {
    key: string;
    content: Buffer | Uint8Array;
    mimeType: string;
  }): Promise<StoredObjectResult> {
    const buf = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content);
    const sha256 = this.calculateHash(buf);
    this.storage.set(input.key, { content: buf, mimeType: input.mimeType });
    return {
      key: input.key,
      sha256,
      fileSize: buf.length,
    };
  }

  async getObject(key: string): Promise<{ content: Buffer; mimeType: string }> {
    const item = this.storage.get(key);
    if (!item) {
      throw new Error(`Object with key '${key}' not found in mock storage`);
    }
    return item;
  }

  async getDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    if (!this.storage.has(key)) {
      throw new Error(`Object with key '${key}' not found in mock storage`);
    }
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    return `https://storage.mock.local/download/${key}?expires=${expiresAt}`;
  }

  async deleteObject(key: string): Promise<boolean> {
    return this.storage.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.storage.has(key);
  }
}

export function getStorageProvider(): EvidenceStorageProvider {
  const mode =
    process.env.STORAGE_PROVIDER_MODE ??
    (process.env.NODE_ENV === "production" ? "s3" : "mock");

  if (mode === "mock") {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.ALLOW_MOCK_STORAGE_IN_PRODUCTION !== "true"
    ) {
      throw new Error(
        "Production safety error: Mock evidence storage provider is strictly forbidden in production mode!"
      );
    }
    return new MockEvidenceStorageProvider();
  } else if (mode === "s3") {
    const bucket = process.env.AWS_S3_BUCKET;
    const region = process.env.AWS_REGION;
    if (!bucket || !region) {
      throw new Error(
        "Production safety error: AWS S3 configuration (AWS_S3_BUCKET, AWS_REGION) is missing!"
      );
    }
    throw new Error("Production safety error: Production S3 storage adapter not configured!");
  }

  throw new Error(`Unsupported storage provider mode: ${mode}`);
}
