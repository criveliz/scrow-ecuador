const SENSITIVE_KEYS = new Set([
    "pan",
    "cardnumber",
    "card_number",
    "cvv",
    "cvv2",
    "cvc",
    "pin",
    "password",
    "secret",
    "token",
    "authorization",
    "private_key",
    "privatekey",
]);
/**
 * Sanitizes payload object to prevent storing PAN, CVV, or authentication tokens.
 */
export function sanitizePayload(input) {
    if (input === null || typeof input !== "object") {
        return input;
    }
    if (Array.isArray(input)) {
        return input.map((item) => sanitizePayload(item));
    }
    const sanitized = {};
    for (const [key, value] of Object.entries(input)) {
        const lowerKey = key.toLowerCase();
        if (SENSITIVE_KEYS.has(lowerKey)) {
            sanitized[key] = "[REDACTED]";
        }
        else if (typeof value === "object" && value !== null) {
            sanitized[key] = sanitizePayload(value);
        }
        else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}
export class WebhookEventRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Atomically records a webhook event, sanitizing payload.
     * If event (provider, event_id) already exists, returns existing event with `isDuplicate: true`.
     */
    async recordEvent(data) {
        // 1. Check existing for early return if already present
        const existing = await this.findByProviderAndEventId(data.provider, data.event_id);
        if (existing) {
            return { event: existing, isDuplicate: true };
        }
        const id = crypto.randomUUID();
        const now = new Date();
        const sanitizedPayload = sanitizePayload(data.payload);
        try {
            const sql = `
        INSERT INTO webhook_events (
          id, provider, event_id, event_type, payload_hash, payload, signature_verified, status, received_at, processed_at, error_message
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `;
            const params = [
                id,
                data.provider,
                data.event_id,
                data.event_type,
                data.payload_hash ?? null,
                JSON.stringify(sanitizedPayload),
                data.signature_verified,
                data.status ?? "RECEIVED",
                now,
                data.processed_at ?? null,
                data.error_message ?? null,
            ];
            const res = await this.db.query(sql, params);
            if (res.rows.length > 0) {
                return { event: res.rows[0], isDuplicate: false };
            }
            throw new Error("Failed to record webhook event");
        }
        catch (err) {
            // Catch duplicate constraint error (e.g. from unique constraint in pg-mem or real Postgres)
            const fetched = await this.findByProviderAndEventId(data.provider, data.event_id);
            if (fetched) {
                return { event: fetched, isDuplicate: true };
            }
            throw err;
        }
    }
    async findByProviderAndEventId(provider, eventId) {
        const sql = `SELECT * FROM webhook_events WHERE provider = $1 AND event_id = $2`;
        const res = await this.db.query(sql, [provider, eventId]);
        return res.rows[0] ?? null;
    }
    async updateStatus(id, status, errorMessage) {
        const now = new Date();
        const sql = `
      UPDATE webhook_events
      SET status = $1, processed_at = $2, error_message = $3
      WHERE id = $4
      RETURNING *
    `;
        const res = await this.db.query(sql, [
            status,
            now,
            errorMessage ?? null,
            id,
        ]);
        if (res.rows.length > 0)
            return res.rows[0];
        throw new Error(`Webhook event not found with id: ${id}`);
    }
}
//# sourceMappingURL=webhook-event.repository.js.map