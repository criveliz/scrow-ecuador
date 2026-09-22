export class ReleaseRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async createRelease(data) {
        const amountNum = parseFloat(data.amount);
        if (isNaN(amountNum) || amountNum <= 0) {
            throw new Error("Release amount must be positive");
        }
        // Check for existing release on this escrow to prevent duplicate release
        const existing = await this.findByEscrowId(data.escrow_id);
        const completedRelease = existing.find((r) => r.status === "COMPLETED" || r.status === "SUCCESS");
        if (completedRelease) {
            throw new Error(`Release already completed for escrow ${data.escrow_id}`);
        }
        const id = crypto.randomUUID();
        const now = new Date();
        const formattedAmount = amountNum.toFixed(2);
        const sql = `
      INSERT INTO releases (
        id, escrow_id, amount, currency, status, provider, provider_release_id, requested_at, completed_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
        const params = [
            id,
            data.escrow_id,
            formattedAmount,
            data.currency ?? "USD",
            data.status,
            data.provider,
            data.provider_release_id ?? null,
            data.requested_at ?? now,
            data.completed_at ?? null,
            now,
            now,
        ];
        const res = await this.db.query(sql, params);
        if (res.rows.length > 0)
            return res.rows[0];
        throw new Error("Failed to create release record");
    }
    async createRefund(data) {
        const amountNum = parseFloat(data.amount);
        if (isNaN(amountNum) || amountNum <= 0) {
            throw new Error("Refund amount must be positive");
        }
        const id = crypto.randomUUID();
        const now = new Date();
        const formattedAmount = amountNum.toFixed(2);
        const sql = `
      INSERT INTO refunds (
        id, escrow_id, amount, currency, status, provider, provider_refund_id, requested_at, completed_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
        const params = [
            id,
            data.escrow_id,
            formattedAmount,
            data.currency ?? "USD",
            data.status,
            data.provider,
            data.provider_refund_id ?? null,
            data.requested_at ?? now,
            data.completed_at ?? null,
            now,
            now,
        ];
        const res = await this.db.query(sql, params);
        if (res.rows.length > 0)
            return res.rows[0];
        throw new Error("Failed to create refund record");
    }
    async findByEscrowId(escrowId) {
        const sql = `SELECT * FROM releases WHERE escrow_id = $1 ORDER BY created_at DESC`;
        const res = await this.db.query(sql, [escrowId]);
        return res.rows;
    }
    async findRefundsByEscrowId(escrowId) {
        const sql = `SELECT * FROM refunds WHERE escrow_id = $1 ORDER BY created_at DESC`;
        const res = await this.db.query(sql, [escrowId]);
        return res.rows;
    }
}
//# sourceMappingURL=release.repository.js.map