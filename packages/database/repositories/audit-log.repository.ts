import { DbClient } from "../db.js";
import { AuditLog } from "../types/index.js";

export class AuditLogRepository {
  constructor(private readonly db: DbClient) {}

  async create(data: Omit<AuditLog, "id" | "created_at">): Promise<AuditLog> {
    const id = crypto.randomUUID();
    const now = new Date();

    const sql = `
      INSERT INTO audit_logs (
        id, actor_id, action, entity_type, entity_id, previous_state, new_state, ip_address, user_agent, metadata, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const params = [
      id,
      data.actor_id ?? null,
      data.action,
      data.entity_type,
      data.entity_id,
      data.previous_state ?? null,
      data.new_state ?? null,
      data.ip_address ?? null,
      data.user_agent ?? null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      now,
    ];

    const res = await this.db.query<AuditLog>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to create audit log record");
  }

  async findByEntity(
    entityType: string,
    entityId: string,
  ): Promise<AuditLog[]> {
    const sql = `
      SELECT * FROM audit_logs
      WHERE entity_type = $1 AND entity_id = $2
      ORDER BY created_at ASC
    `;
    const res = await this.db.query<AuditLog>(sql, [entityType, entityId]);
    return res.rows;
  }
}
