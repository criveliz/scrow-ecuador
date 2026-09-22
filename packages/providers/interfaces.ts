export interface PaymentIntent {
  providerReference: string;
  amount: string;
  currency: "USD";
  status: "PENDING" | "PAID" | "FAILED";
  paymentUrl?: string;
}

export interface PaymentProvider {
  createPaymentIntent(input: {
    escrowId: string;
    amount: string;
    currency: "USD";
    idempotencyKey: string;
  }): Promise<PaymentIntent>;

  verifyWebhook(input: {
    rawBody: string;
    signature: string;
  }): Promise<{
    eventId: string;
    eventType: string;
    payload: unknown;
  }>;
}

export interface FiduciaryProvider {
  verifyIncomingFunds(input: {
    escrowId: string;
    expectedAmount: string;
    reference: string;
  }): Promise<{
    confirmed: boolean;
    providerReference?: string;
  }>;

  requestRelease(input: {
    escrowId: string;
    amount: string;
    idempotencyKey: string;
  }): Promise<{
    providerReference: string;
    status: "PENDING" | "COMPLETED" | "FAILED";
  }>;

  requestRefund(input: {
    escrowId: string;
    amount: string;
    idempotencyKey: string;
  }): Promise<{
    providerReference: string;
    status: "PENDING" | "COMPLETED" | "FAILED";
  }>;
}

export interface UploadIntentInput {
  escrowId: string;
  filename: string;
  mimeType: string;
  fileSize: number;
}

export interface UploadIntentResult {
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
}

export interface StoredObjectResult {
  key: string;
  sha256: string;
  fileSize: number;
}

export interface EvidenceStorageProvider {
  createUploadIntent(input: UploadIntentInput): Promise<UploadIntentResult>;
  putObject(input: {
    key: string;
    content: Buffer | Uint8Array;
    mimeType: string;
  }): Promise<StoredObjectResult>;
  getObject(key: string): Promise<{ content: Buffer; mimeType: string }>;
  getDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  deleteObject(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  calculateHash(content: Buffer | Uint8Array): string;
}
