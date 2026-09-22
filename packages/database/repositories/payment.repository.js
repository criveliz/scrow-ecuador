export class PaymentRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async create(data) {
        const amountNum = parseFloat(data.amount);
        if (isNaN(amountNum) || amountNum <= 0) {
            throw new Error("Payment amount must be positive");
        }
        const id = crypto.randomUUID();
        const now = new Date();
        const formattedAmount = amountNum.toFixed(2);
        const sql = `
      INSERT INTO payments (
        id, escrow_id, provider, provider_payment_id, amount, currency, status, provider_reference, received_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
        const params = [
            id,
            data.escrow_id,
            data.provider,
            data.provider_payment_id ?? null,
            formattedAmount,
            data.currency ?? "USD",
            data.status,
            data.provider_reference ?? null,
            data.received_at ?? null,
            now,
            now,
        ];
        const res = await this.db.query(sql, params);
        if (res.rows.length > 0)
            return res.rows[0];
        throw new Error("Failed to create payment record");
    }
    async findByEscrowId(escrowId) {
        const sql = `SELECT * FROM payments WHERE escrow_id = $1 ORDER BY created_at DESC`;
        const res = await this.db.query(sql, [escrowId]);
        return res.rows;
    }
    async findByProviderReference(provider, ref) {
        const sql = `SELECT * FROM payments WHERE provider = $1 AND provider_reference = $2`;
        const res = await this.db.query(sql, [provider, ref]);
        return res.rows[0] ?? null;
    }
}
//# sourceMappingURL=payment.repository.js.map