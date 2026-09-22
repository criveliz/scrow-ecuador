import { DbClient } from "../db.js";
import { Refund, Release } from "../types/index.js";

export class ReleaseRepository {
  constructor(private readonly db: DbClient) {}

  async createRelease(data: Omit<Release, "id" | "created_at" | "updated_at">): Promise<Release> {
    const amountNum = parseFloat(data.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error("Release amount must be positive");
    }

    if (data.idempotency_key) {
      const existingKey = await this.findByIdempotencyKey(data.idempotency_key);
      if (existingKey) return existingKey;
    }

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
        id, escrow_id, amount, currency, status, provider, provider_release_id, idempotency_key, failure_code, failure_reason, requested_at, completed_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
      data.idempotency_key ?? null,
      data.failure_code ?? null,
      data.failure_reason ?? null,
      data.requested_at ?? now,
      data.completed_at ?? null,
      now,
      now,
    ];

    const res = await this.db.query<Release>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to create release record");
  }

  async createRefund(data: Omit<Refund, "id" | "created_at" | "updated_at">): Promise<Refund> {
    const amountNum = parseFloat(data.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error("Refund amount must be positive");
    }

    if (data.idempotency_key) {
      const existingKey = await this.findRefundByIdempotencyKey(data.idempotency_key);
      if (existingKey) return existingKey;
    }

    const id = crypto.randomUUID();
    const now = new Date();
    const formattedAmount = amountNum.toFixed(2);

    const sql = `
      INSERT INTO refunds (
        id, escrow_id, amount, currency, status, provider, provider_refund_id, idempotency_key, failure_code, failure_reason, requested_at, completed_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
      data.idempotency_key ?? null,
      data.failure_code ?? null,
      data.failure_reason ?? null,
      data.requested_at ?? now,
      data.completed_at ?? null,
      now,
      now,
    ];

    const res = await this.db.query<Refund>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to create refund record");
  }

  async findById(id: string): Promise<Release | null> {
    const sql = `SELECT * FROM releases WHERE id = $1`;
    const res = await this.db.query<Release>(sql, [id]);
    return res.rows[0] ?? null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Release | null> {
    const sql = `SELECT * FROM releases WHERE idempotency_key = $1`;
    const res = await this.db.query<Release>(sql, [idempotencyKey]);
    return res.rows[0] ?? null;
  }

  async findByEscrowId(escrowId: string): Promise<Release[]> {
    const sql = `SELECT * FROM releases WHERE escrow_id = $1 ORDER BY created_at DESC`;
    const res = await this.db.query<Release>(sql, [escrowId]);
    return res.rows;
  }

  async updateReleaseStatus(
    id: string,
    status: string,
    opts?: { providerReleaseId?: string; failureCode?: string; failureReason?: string; completedAt?: Date }
  ): Promise<Release> {
    const now = new Date();
    const completedAt = opts?.completedAt ?? (status === "COMPLETED" ? now : null);
    const sql = `
      UPDATE releases
      SET status = $1,
          provider_release_id = COALESCE($2, provider_release_id),
          failure_code = COALESCE($3, failure_code),
          failure_reason = COALESCE($4, failure_reason),
          completed_at = COALESCE($5, completed_at),
          updated_at = $6
      WHERE id = $7
      RETURNING *
    `;
    const res = await this.db.query<Release>(sql, [
      status,
      opts?.providerReleaseId ?? null,
      opts?.failureCode ?? null,
      opts?.failureReason ?? null,
      completedAt,
      now,
      id,
    ]);
    if (res.rows.length > 0) return res.rows[0];
    throw new Error(`Release record ${id} not found for status update`);
  }

  async findRefundById(id: string): Promise<Refund | null> {
    const sql = `SELECT * FROM refunds WHERE id = $1`;
    const res = await this.db.query<Refund>(sql, [id]);
    return res.rows[0] ?? null;
  }

  async findRefundByIdempotencyKey(idempotencyKey: string): Promise<Refund | null> {
    const sql = `SELECT * FROM refunds WHERE idempotency_key = $1`;
    const res = await this.db.query<Refund>(sql, [idempotencyKey]);
    return res.rows[0] ?? null;
  }

  async findRefundsByEscrowId(escrowId: string): Promise<Refund[]> {
    const sql = `SELECT * FROM refunds WHERE escrow_id = $1 ORDER BY created_at DESC`;
    const res = await this.db.query<Refund>(sql, [escrowId]);
    return res.rows;
  }

  async updateRefundStatus(
    id: string,
    status: string,
    opts?: { providerRefundId?: string; failureCode?: string; failureReason?: string; completedAt?: Date }
  ): Promise<Refund> {
    const now = new Date();
    const completedAt = opts?.completedAt ?? (status === "COMPLETED" ? now : null);
    const sql = `
      UPDATE refunds
      SET status = $1,
          provider_refund_id = COALESCE($2, provider_refund_id),
          failure_code = COALESCE($3, failure_code),
          failure_reason = COALESCE($4, failure_reason),
          completed_at = COALESCE($5, completed_at),
          updated_at = $6
      WHERE id = $7
      RETURNING *
    `;
    const res = await this.db.query<Refund>(sql, [
      status,
      opts?.providerRefundId ?? null,
      opts?.failureCode ?? null,
      opts?.failureReason ?? null,
      completedAt,
      now,
      id,
    ]);
    if (res.rows.length > 0) return res.rows[0];
    throw new Error(`Refund record ${id} not found for status update`);
  }
}
