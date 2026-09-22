import { DbClient } from "../db.js";
import { Evidence, EvidenceAccessEvent } from "../types/index.js";

export class EvidenceRepository {
  constructor(private readonly db: DbClient) {}

  async create(data: Omit<Evidence, "id" | "created_at">): Promise<Evidence> {
    const id = crypto.randomUUID();
    const now = new Date();

    const sql = `
      INSERT INTO evidence (
        id, escrow_id, uploaded_by, type, description, storage_reference, sha256,
        mime_type, file_size, original_filename, captured_at, status, visibility,
        replaced_by_id, ip_address, user_agent, metadata, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *
    `;
    const params = [
      id,
      data.escrow_id,
      data.uploaded_by,
      data.type,
      data.description ?? null,
      data.storage_reference,
      data.sha256 ?? null,
      data.mime_type ?? "application/octet-stream",
      data.file_size ?? 0,
      data.original_filename ?? null,
      data.captured_at ?? null,
      data.status ?? "ACTIVE",
      data.visibility ?? "PARTICIPANTS",
      data.replaced_by_id ?? null,
      data.ip_address ?? null,
      data.user_agent ?? null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      now,
    ];

    const res = await this.db.query<Evidence>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to create evidence record");
  }

  async findById(id: string): Promise<Evidence | null> {
    const sql = `SELECT * FROM evidence WHERE id = $1`;
    const res = await this.db.query<Evidence>(sql, [id]);
    return res.rows[0] ?? null;
  }

  async findByEscrowId(escrowId: string): Promise<Evidence[]> {
    const sql = `SELECT * FROM evidence WHERE escrow_id = $1 ORDER BY created_at DESC`;
    const res = await this.db.query<Evidence>(sql, [escrowId]);
    return res.rows;
  }

  async markReplaced(oldEvidenceId: string, newEvidenceId: string): Promise<Evidence> {
    const sql = `
      UPDATE evidence
      SET status = 'REPLACED', replaced_by_id = $1
      WHERE id = $2
      RETURNING *
    `;
    const res = await this.db.query<Evidence>(sql, [newEvidenceId, oldEvidenceId]);
    if (res.rows.length > 0) return res.rows[0];
    throw new Error(`Evidence ${oldEvidenceId} not found`);
  }

  async updateStatus(id: string, status: string): Promise<Evidence> {
    const sql = `
      UPDATE evidence
      SET status = $1
      WHERE id = $2
      RETURNING *
    `;
    const res = await this.db.query<Evidence>(sql, [status, id]);
    if (res.rows.length > 0) return res.rows[0];
    throw new Error(`Evidence ${id} not found`);
  }

  async createAccessEvent(
    data: Omit<EvidenceAccessEvent, "id" | "accessed_at">
  ): Promise<EvidenceAccessEvent> {
    const id = crypto.randomUUID();
    const now = new Date();

    const sql = `
      INSERT INTO evidence_access_events (
        id, evidence_id, actor_id, action, ip_address, user_agent, accessed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const params = [
      id,
      data.evidence_id,
      data.actor_id ?? null,
      data.action,
      data.ip_address ?? null,
      data.user_agent ?? null,
      now,
    ];

    const res = await this.db.query<EvidenceAccessEvent>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to record evidence access event");
  }

  async getAccessEvents(evidenceId: string): Promise<EvidenceAccessEvent[]> {
    const sql = `SELECT * FROM evidence_access_events WHERE evidence_id = $1 ORDER BY accessed_at DESC`;
    const res = await this.db.query<EvidenceAccessEvent>(sql, [evidenceId]);
    return res.rows;
  }
}
