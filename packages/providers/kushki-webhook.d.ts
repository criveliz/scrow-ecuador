export declare enum InternalPaymentStatus {
    PENDING = "PENDING",
    PROCESSING = "PROCESSING",
    APPROVED = "APPROVED",
    DECLINED = "DECLINED",
    FAILED = "FAILED",
    RECONCILIATION_MISMATCH = "RECONCILIATION_MISMATCH",
    UNMATCHED = "UNMATCHED",
    UNKNOWN = "UNKNOWN"
}
export interface KushkiWebhookPayload {
    event_id?: string;
    eventId?: string;
    event_type?: string;
    eventType?: string;
    ticketNumber?: string;
    transaction_id?: string;
    transactionId?: string;
    token?: string;
    status?: string;
    transactionStatus?: string;
    amount?: {
        subtotalIva?: number;
        subtotalIva0?: number;
        ice?: number;
        iva?: number;
        currency?: string;
        totalAmount?: number | string;
    } | number | string;
    currency?: string;
    timestamp?: number | string;
    created_at?: string;
    metadata?: Record<string, unknown>;
    escrow_id?: string;
    escrowId?: string;
    [key: string]: unknown;
}
export interface VerifiedKushkiEvent {
    eventId: string;
    eventType: string;
    providerTransactionId: string;
    escrowId?: string;
    rawStatus: string;
    mappedStatus: InternalPaymentStatus;
    amount: string;
    currency: string;
    timestamp?: string;
    payload: KushkiWebhookPayload;
}
export declare class KushkiMapper {
    /**
     * Maps Kushki external transaction status to internal PaymentStatus.
     */
    static mapStatus(rawStatus: string): InternalPaymentStatus;
    /**
     * Determines if incoming status transition is valid (i.e. does not downgrade an existing state due to out-of-order events).
     */
    static isOutofOrderOrObsolete(currentStatus: InternalPaymentStatus | string, incomingStatus: InternalPaymentStatus): boolean;
}
export interface KushkiWebhookVerifierConfig {
    webhookSecret?: string;
    replayToleranceSeconds?: number;
}
export declare class KushkiWebhookVerifier {
    private secret;
    private toleranceSeconds;
    constructor(config?: KushkiWebhookVerifierConfig);
    /**
     * Verifies incoming Kushki webhook signature and checks timestamp replay window.
     * Documented UAT / Production configuration:
     * Uses Kushki signature specification: HMAC SHA256 of raw body or timestamp+body against webhook secret.
     */
    verifySignatureAndTimestamp(input: {
        rawBody: string;
        signature?: string;
        timestampHeader?: string;
    }): {
        valid: boolean;
        reason?: string;
    };
    /**
     * Parses and extracts standardized event attributes from Kushki body.
     */
    extractEvent(payload: KushkiWebhookPayload): VerifiedKushkiEvent;
}
/**
 * Mock Kushki Webhook Provider for unit & integration testing.
 */
export declare class MockKushkiWebhookProvider {
    private verifier;
    constructor(secret?: string);
    createSignedWebhook(params: {
        eventId?: string;
        eventType?: string;
        transactionId: string;
        escrowId?: string;
        amount: string;
        currency?: string;
        status: string;
        timestampMs?: number;
        secret?: string;
    }): {
        rawBody: string;
        signature: string;
        timestampHeader: string;
    };
    verify(rawBody: string, signature: string, timestampHeader?: string): {
        valid: boolean;
        reason?: string;
    };
    parse(rawBody: string): VerifiedKushkiEvent;
}
//# sourceMappingURL=kushki-webhook.d.ts.map