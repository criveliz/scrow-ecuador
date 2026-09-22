import { DbClient } from "../db.js";
import { DisputeEvent } from "../types/index.js";

export class DisputeEventRepository {
  constructor(private readonly db: DbClient) {}

  async createEvent(
    data: Omit<DisputeEvent, "id" | "created_at">
  ): Promise<DisputeEvent> {
    const id = crypto.randomUUID();
    const now = new Date();

    const sql = `
      INSERT INTO dispute_events (
        id, dispute_id, previous_status, new_status, actor_id, actor_role, action, reason, metadata, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    const params = [
      id,
      data.dispute_id,
      data.previous_status ?? null,
      data.new_status,
      data.actor_id ?? null,
      data.actor_role,
      data.action,
      data.reason ?? null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      now,
    ];

    const res = await this.db.query<DisputeEvent>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to create dispute event record");
  }

  async findByDisputeId(disputeId: string): Promise<DisputeEvent[]> {
    const sql = `SELECT * FROM dispute_events WHERE dispute_id = $1 ORDER BY created_at ASC`;
    const res = await this.db.query<DisputeEvent>(sql, [disputeId]);
    return res.rows;
  }
}
