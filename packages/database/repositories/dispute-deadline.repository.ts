import { DbClient } from "../db.js";
import { DisputeDeadline } from "../types/index.js";

export class DisputeDeadlineRepository {
  constructor(private readonly db: DbClient) {}

  async createDeadline(
    data: Omit<DisputeDeadline, "id" | "created_at">
  ): Promise<DisputeDeadline> {
    const id = crypto.randomUUID();
    const now = new Date();

    const sql = `
      INSERT INTO dispute_deadlines (
        id, dispute_id, deadline_type, due_at, status, created_at, expired_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const params = [
      id,
      data.dispute_id,
      data.deadline_type,
      new Date(data.due_at),
      data.status ?? "PENDING",
      now,
      data.expired_at ? new Date(data.expired_at) : null,
    ];

    const res = await this.db.query<DisputeDeadline>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to create dispute deadline record");
  }

  async findByDisputeId(disputeId: string): Promise<DisputeDeadline[]> {
    const sql = `SELECT * FROM dispute_deadlines WHERE dispute_id = $1 ORDER BY due_at ASC`;
    const res = await this.db.query<DisputeDeadline>(sql, [disputeId]);
    return res.rows;
  }

  async findPendingPastDue(asOf = new Date()): Promise<DisputeDeadline[]> {
    const sql = `SELECT * FROM dispute_deadlines WHERE status = 'PENDING' AND due_at <= $1 ORDER BY due_at ASC`;
    const res = await this.db.query<DisputeDeadline>(sql, [asOf]);
    return res.rows;
  }

  async updateStatus(id: string, status: string, expiredAt?: Date | string): Promise<DisputeDeadline> {
    const sql = `
      UPDATE dispute_deadlines
      SET status = $1, expired_at = COALESCE($2, expired_at)
      WHERE id = $3
      RETURNING *
    `;
    const res = await this.db.query<DisputeDeadline>(sql, [
      status,
      expiredAt ? new Date(expiredAt) : status === "EXPIRED" ? new Date() : null,
      id,
    ]);
    if (res.rows.length > 0) return res.rows[0];
    throw new Error(`Dispute deadline ${id} not found`);
  }
}
