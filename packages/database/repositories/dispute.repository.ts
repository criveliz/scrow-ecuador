import { DbClient } from "../db.js";
import { Dispute } from "../types/index.js";

export class DisputeRepository {
  constructor(private readonly db: DbClient) {}

  async create(data: Omit<Dispute, "id" | "created_at" | "updated_at">): Promise<Dispute> {
    const id = crypto.randomUUID();
    const now = new Date();

    const sql = `
      INSERT INTO disputes (
        id, escrow_id, opened_by, reason, description, status, resolved_by, resolution, opened_at, resolved_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;
    const params = [
      id,
      data.escrow_id,
      data.opened_by,
      data.reason,
      data.description ?? null,
      data.status ?? "OPEN",
      data.resolved_by ?? null,
      data.resolution ?? null,
      data.opened_at ?? now,
      data.resolved_at ?? null,
      now,
      now,
    ];

    const res = await this.db.query<Dispute>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to create dispute record");
  }

  async findByEscrowId(escrowId: string): Promise<Dispute[]> {
    const sql = `SELECT * FROM disputes WHERE escrow_id = $1 ORDER BY created_at DESC`;
    const res = await this.db.query<Dispute>(sql, [escrowId]);
    return res.rows;
  }

  async resolve(
    id: string,
    resolvedBy: string,
    resolution: string,
    status = "RESOLVED"
  ): Promise<Dispute> {
    const now = new Date();
    const sql = `
      UPDATE disputes
      SET status = $1, resolved_by = $2, resolution = $3, resolved_at = $4, updated_at = $4
      WHERE id = $5
      RETURNING *
    `;
    const res = await this.db.query<Dispute>(sql, [status, resolvedBy, resolution, now, id]);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error(`Dispute ${id} not found`);
  }
}
