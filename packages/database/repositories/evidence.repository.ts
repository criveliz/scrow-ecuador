import { DbClient } from "../db.js";
import { Evidence } from "../types/index.js";

export class EvidenceRepository {
  constructor(private readonly db: DbClient) {}

  async create(data: Omit<Evidence, "id" | "created_at">): Promise<Evidence> {
    const id = crypto.randomUUID();
    const now = new Date();

    const sql = `
      INSERT INTO evidence (
        id, escrow_id, uploaded_by, type, storage_reference, sha256, metadata, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const params = [
      id,
      data.escrow_id,
      data.uploaded_by,
      data.type,
      data.storage_reference,
      data.sha256 ?? null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      now,
    ];

    const res = await this.db.query<Evidence>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to create evidence record");
  }

  async findByEscrowId(escrowId: string): Promise<Evidence[]> {
    const sql = `SELECT * FROM evidence WHERE escrow_id = $1 ORDER BY created_at DESC`;
    const res = await this.db.query<Evidence>(sql, [escrowId]);
    return res.rows;
  }
}
