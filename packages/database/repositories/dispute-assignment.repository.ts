import { DbClient } from "../db.js";
import { DisputeAssignment } from "../types/index.js";

export class DisputeAssignmentRepository {
  constructor(private readonly db: DbClient) {}

  async createAssignment(
    data: Omit<DisputeAssignment, "id" | "assigned_at">
  ): Promise<DisputeAssignment> {
    const id = crypto.randomUUID();
    const now = new Date();

    const sql = `
      INSERT INTO dispute_assignments (
        id, dispute_id, assigned_to, assigned_by, assigned_at
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const params = [
      id,
      data.dispute_id,
      data.assigned_to,
      data.assigned_by,
      now,
    ];

    const res = await this.db.query<DisputeAssignment>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to record dispute assignment");
  }

  async findByDisputeId(disputeId: string): Promise<DisputeAssignment[]> {
    const sql = `SELECT * FROM dispute_assignments WHERE dispute_id = $1 ORDER BY assigned_at DESC`;
    const res = await this.db.query<DisputeAssignment>(sql, [disputeId]);
    return res.rows;
  }
}
