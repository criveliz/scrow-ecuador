import { DbClient } from "../db.js";
import { DisputeEvidence, Evidence } from "../types/index.js";

export class DisputeEvidenceRepository {
  constructor(private readonly db: DbClient) {}

  async linkEvidence(
    data: Omit<DisputeEvidence, "id" | "created_at">
  ): Promise<DisputeEvidence> {
    const id = crypto.randomUUID();
    const now = new Date();

    const sql = `
      INSERT INTO dispute_evidence (
        id, dispute_id, evidence_id, requested_by, submitted_by, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (dispute_id, evidence_id) DO UPDATE SET created_at = EXCLUDED.created_at
      RETURNING *
    `;
    const params = [
      id,
      data.dispute_id,
      data.evidence_id,
      data.requested_by ?? null,
      data.submitted_by,
      now,
    ];

    const res = await this.db.query<DisputeEvidence>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to link evidence to dispute");
  }

  async findByDisputeId(disputeId: string): Promise<DisputeEvidence[]> {
    const sql = `SELECT * FROM dispute_evidence WHERE dispute_id = $1 ORDER BY created_at ASC`;
    const res = await this.db.query<DisputeEvidence>(sql, [disputeId]);
    return res.rows;
  }

  async findEvidenceRecordsByDisputeId(disputeId: string): Promise<Evidence[]> {
    const sql = `
      SELECT e.*
      FROM evidence e
      INNER JOIN dispute_evidence de ON de.evidence_id = e.id
      WHERE de.dispute_id = $1
      ORDER BY e.created_at ASC
    `;
    const res = await this.db.query<Evidence>(sql, [disputeId]);
    return res.rows;
  }
}
