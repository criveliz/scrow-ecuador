import crypto from "node:crypto";
export var InternalPaymentStatus;
(function (InternalPaymentStatus) {
    InternalPaymentStatus["PENDING"] = "PENDING";
    InternalPaymentStatus["PROCESSING"] = "PROCESSING";
    InternalPaymentStatus["APPROVED"] = "APPROVED";
    InternalPaymentStatus["DECLINED"] = "DECLINED";
    InternalPaymentStatus["FAILED"] = "FAILED";
    InternalPaymentStatus["RECONCILIATION_MISMATCH"] = "RECONCILIATION_MISMATCH";
    InternalPaymentStatus["UNMATCHED"] = "UNMATCHED";
    InternalPaymentStatus["UNKNOWN"] = "UNKNOWN";
})(InternalPaymentStatus || (InternalPaymentStatus = {}));
/**
 * Priority rank for internal payment statuses to handle out-of-order events.
 * Higher rank wins over lower rank.
 */
const STATUS_RANK = {
    [InternalPaymentStatus.PENDING]: 1,
    [InternalPaymentStatus.PROCESSING]: 2,
    [InternalPaymentStatus.APPROVED]: 3,
    [InternalPaymentStatus.DECLINED]: 3,
    [InternalPaymentStatus.FAILED]: 3,
    [InternalPaymentStatus.RECONCILIATION_MISMATCH]: 4,
    [InternalPaymentStatus.UNMATCHED]: 0,
    [InternalPaymentStatus.UNKNOWN]: 0,
};
export class KushkiMapper {
    /**
     * Maps Kushki external transaction status to internal PaymentStatus.
     */
    static mapStatus(rawStatus) {
        const normalized = (rawStatus || "").trim().toUpperCase();
        switch (normalized) {
            case "APPROVAL":
            case "APPROVED":
            case "SETTLED":
            case "SUCCESS":
            case "SUCCESSFUL":
                return InternalPaymentStatus.APPROVED;
            case "PROCESSING":
            case "INITIALIZED":
            case "PENDING":
            case "IN_PROGRESS":
                return InternalPaymentStatus.PROCESSING;
            case "DECLINED":
            case "REJECTED":
            case "CARD_DECLINED":
                return InternalPaymentStatus.DECLINED;
            case "FAILED":
            case "ERROR":
            case "CANCELLED":
            case "VOIDED":
                return InternalPaymentStatus.FAILED;
            default:
                return InternalPaymentStatus.UNKNOWN;
        }
    }
    /**
     * Determines if incoming status transition is valid (i.e. does not downgrade an existing state due to out-of-order events).
     */
    static isOutofOrderOrObsolete(currentStatus, incomingStatus) {
        const currentEnum = currentStatus || InternalPaymentStatus.PENDING;
        const currentRank = STATUS_RANK[currentEnum] ?? 0;
        const incomingRank = STATUS_RANK[incomingStatus] ?? 0;
        // If current state is terminal/final (APPROVED, DECLINED, FAILED, MISMATCH) and incoming rank is lower, it's obsolete.
        return incomingRank < currentRank;
    }
}
export class KushkiWebhookVerifier {
    secret;
    toleranceSeconds;
    constructor(config) {
        this.secret = config?.webhookSecret || process.env.KUSHKI_WEBHOOK_SECRET || "mock-kushki-secret";
        this.toleranceSeconds = config?.replayToleranceSeconds ?? 300;
    }
    /**
     * Verifies incoming Kushki webhook signature and checks timestamp replay window.
     * Documented UAT / Production configuration:
     * Uses Kushki signature specification: HMAC SHA256 of raw body or timestamp+body against webhook secret.
     */
    verifySignatureAndTimestamp(input) {
        if (!input.rawBody) {
            return { valid: false, reason: "Missing body" };
        }
        if (!input.signature) {
            return { valid: false, reason: "Missing Kushki signature header" };
        }
        // Check replay attack timestamp window if timestamp provided
        if (input.timestampHeader) {
            const timestampMs = Number(input.timestampHeader);
            if (isNaN(timestampMs)) {
                return { valid: false, reason: "Invalid timestamp header format" };
            }
            const nowMs = Date.now();
            const ageSeconds = Math.abs(nowMs - timestampMs) / 1000;
            if (ageSeconds > this.toleranceSeconds) {
                return { valid: false, reason: `Timestamp out of tolerance window (${ageSeconds.toFixed(0)}s > ${this.toleranceSeconds}s)` };
            }
        }
        // Compute expected HMAC-SHA256 signature
        const hmac = crypto.createHmac("sha256", this.secret);
        if (input.timestampHeader) {
            hmac.update(`${input.timestampHeader}.${input.rawBody}`);
        }
        else {
            hmac.update(input.rawBody);
        }
        const expectedSignature = hmac.digest("hex");
        const sigBuf = Buffer.from(input.signature.toLowerCase());
        const expectedBuf = Buffer.from(expectedSignature.toLowerCase());
        if (sigBuf.length !== expectedBuf.length) {
            return { valid: false, reason: "Signature mismatch" };
        }
        const match = crypto.timingSafeEqual(sigBuf, expectedBuf);
        if (!match) {
            return { valid: false, reason: "Signature mismatch" };
        }
        return { valid: true };
    }
    /**
     * Parses and extracts standardized event attributes from Kushki body.
     */
    extractEvent(payload) {
        const eventId = String(payload.event_id || payload.eventId || payload.ticketNumber || `evt_${Date.now()}`);
        const eventType = String(payload.event_type || payload.eventType || "transaction.processed");
        const providerTransactionId = String(payload.transaction_id || payload.transactionId || payload.ticketNumber || payload.token || "");
        const rawStatus = String(payload.status || payload.transactionStatus || "UNKNOWN");
        const mappedStatus = KushkiMapper.mapStatus(rawStatus);
        // Extract amount safely as NUMERIC string with 2 decimals
        let amountStr = "0.00";
        if (typeof payload.amount === "object" && payload.amount !== null) {
            const tot = payload.amount.totalAmount;
            if (tot !== undefined && tot !== null) {
                amountStr = parseFloat(String(tot)).toFixed(2);
            }
        }
        else if (payload.amount !== undefined && payload.amount !== null) {
            amountStr = parseFloat(String(payload.amount)).toFixed(2);
        }
        const currency = String(payload.currency || "USD").toUpperCase();
        const escrowId = payload.escrow_id || payload.escrowId ? String(payload.escrow_id || payload.escrowId) : undefined;
        const timestamp = payload.timestamp ? new Date(payload.timestamp).toISOString() : payload.created_at || new Date().toISOString();
        return {
            eventId,
            eventType,
            providerTransactionId,
            escrowId,
            rawStatus,
            mappedStatus,
            amount: amountStr,
            currency,
            timestamp,
            payload,
        };
    }
}
/**
 * Mock Kushki Webhook Provider for unit & integration testing.
 */
export class MockKushkiWebhookProvider {
    verifier;
    constructor(secret = "test-kushki-secret") {
        this.verifier = new KushkiWebhookVerifier({ webhookSecret: secret, replayToleranceSeconds: 300 });
    }
    createSignedWebhook(params) {
        const payload = {
            event_id: params.eventId || `evt_mock_${Math.random().toString(36).substring(7)}`,
            event_type: params.eventType || "transaction.processed",
            transaction_id: params.transactionId,
            escrow_id: params.escrowId,
            amount: params.amount,
            currency: params.currency || "USD",
            status: params.status,
            timestamp: params.timestampMs || Date.now(),
        };
        const rawBody = JSON.stringify(payload);
        const tsHeader = String(params.timestampMs || Date.now());
        const verifierSecret = params.secret || "test-kushki-secret";
        const hmac = crypto.createHmac("sha256", verifierSecret);
        hmac.update(`${tsHeader}.${rawBody}`);
        const signature = hmac.digest("hex");
        return { rawBody, signature, timestampHeader: tsHeader };
    }
    verify(rawBody, signature, timestampHeader) {
        return this.verifier.verifySignatureAndTimestamp({ rawBody, signature, timestampHeader });
    }
    parse(rawBody) {
        const payload = JSON.parse(rawBody);
        return this.verifier.extractEvent(payload);
    }
}
//# sourceMappingURL=kushki-webhook.js.map