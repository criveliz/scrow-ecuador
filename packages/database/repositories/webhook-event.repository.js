export class WebhookEventRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async recordEvent(data) {
        // Check if event was already recorded for idempotency
        const existing = await this.findByProviderAndEventId(data.provider, data.event_id);
        if (existing) {
            throw new Error(`Duplicate webhook event: ${data.provider} / ${data.event_id}`);
        }
        const id = crypto.randomUUID();
        const now = new Date();
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
            JSON.stringify(data.payload),
            data.signature_verified,
            data.status ?? "RECEIVED",
            now,
            data.processed_at ?? null,
            data.error_message ?? null,
        ];
        const res = await this.db.query(sql, params);
        if (res.rows.length > 0)
            return res.rows[0];
        throw new Error("Failed to record webhook event");
    }
    async findByProviderAndEventId(provider, eventId) {
        const sql = `SELECT * FROM webhook_events WHERE provider = $1 AND event_id = $2`;
        const res = await this.db.query(sql, [provider, eventId]);
        return res.rows[0] ?? null;
    }
}
//# sourceMappingURL=webhook-event.repository.js.map