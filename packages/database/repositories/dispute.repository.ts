import { DbClient } from "../db.js";
import { Dispute } from "../types/index.js";

export class DisputeRepository {
  constructor(private readonly db: DbClient) {}

  async create(data: Omit<Dispute, "id" | "created_at" | "updated_at">): Promise<Dispute> {
    const id = crypto.randomUUID();
    const now = new Date();

    const sql = `
      INSERT INTO disputes (
        id, escrow_id, opened_by, reason, description, status, assigned_to,
        resolved_by, resolution, resolution_reason, opened_at, resolved_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;
    const params = [
      id,
      data.escrow_id,
      data.opened_by,
      data.reason,
      data.description ?? null,
      data.status ?? "OPEN",
      data.assigned_to ?? null,
      data.resolved_by ?? null,
      data.resolution ?? null,
      data.resolution_reason ?? null,
      data.opened_at ?? now,
      data.resolved_at ?? null,
      now,
      now,
    ];

    const res = await this.db.query<Dispute>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to create dispute record");
  }

  async findById(id: string): Promise<Dispute | null> {
    const sql = `SELECT * FROM disputes WHERE id = $1`;
    const res = await this.db.query<Dispute>(sql, [id]);
    return res.rows[0] ?? null;
  }

  async findByEscrowId(escrowId: string): Promise<Dispute[]> {
    const sql = `SELECT * FROM disputes WHERE escrow_id = $1 ORDER BY created_at DESC`;
    const res = await this.db.query<Dispute>(sql, [escrowId]);
    return res.rows;
  }

  async findActiveByEscrowId(escrowId: string): Promise<Dispute | null> {
    const sql = `
      SELECT * FROM disputes
      WHERE escrow_id = $1
        AND status NOT IN ('RESOLVED_BUYER', 'RESOLVED_SELLER', 'RESOLVED_SPLIT', 'CANCELLED', 'CLOSED')
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const res = await this.db.query<Dispute>(sql, [escrowId]);
    return res.rows[0] ?? null;
  }

  async assign(id: string, assignedTo: string): Promise<Dispute> {
    const now = new Date();
    const sql = `
      UPDATE disputes
      SET assigned_to = $1, updated_at = $2
      WHERE id = $3
      RETURNING *
    `;
    const res = await this.db.query<Dispute>(sql, [assignedTo, now, id]);
    if (res.rows.length > 0) return res.rows[0];
    throw new Error(`Dispute ${id} not found`);
  }

  async updateStatus(
    id: string,
    status: string,
    resolvedBy?: string | null,
    resolution?: string | null,
    resolutionReason?: string | null
  ): Promise<Dispute> {
    const now = new Date();
    const isTerminal = ["RESOLVED_BUYER", "RESOLVED_SELLER", "RESOLVED_SPLIT", "CANCELLED", "CLOSED"].includes(status);
    const resolvedAt = isTerminal ? now : null;

    const sql = `
      UPDATE disputes
      SET status = $1,
          resolved_by = COALESCE($2, resolved_by),
          resolution = COALESCE($3, resolution),
          resolution_reason = COALESCE($4, resolution_reason),
          resolved_at = COALESCE($5, resolved_at),
          updated_at = $6
      WHERE id = $7
      RETURNING *
    `;
    const res = await this.db.query<Dispute>(sql, [
      status,
      resolvedBy ?? null,
      resolution ?? null,
      resolutionReason ?? null,
      resolvedAt,
      now,
      id,
    ]);

    if (res.rows.length > 0) return res.rows[0];
    throw new Error(`Dispute ${id} not found`);
  }

  async resolve(
    id: string,
    resolvedBy: string,
    resolution: string,
    status = "RESOLVED_BUYER",
    resolutionReason?: string
  ): Promise<Dispute> {
    return this.updateStatus(id, status, resolvedBy, resolution, resolutionReason);
  }
}
