import { DbClient } from "../db.js";

export interface RefreshTokenRecord {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string;
  revoked: boolean;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

export class RefreshTokenRepository {
  constructor(private readonly db: DbClient) {}

  async create(data: {
    user_id: string;
    token_hash: string;
    family_id: string;
    expires_at: Date;
  }): Promise<RefreshTokenRecord> {
    const id = crypto.randomUUID();
    const now = new Date();
    const sql = `
      INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, revoked, expires_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const params = [
      id,
      data.user_id,
      data.token_hash,
      data.family_id,
      false,
      data.expires_at,
      now,
      now,
    ];

    const res = await this.db.query<RefreshTokenRecord>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to create refresh token record");
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const sql = `SELECT * FROM refresh_tokens WHERE token_hash = $1`;
    const res = await this.db.query<RefreshTokenRecord>(sql, [tokenHash]);
    return res.rows[0] ?? null;
  }

  async revoke(id: string): Promise<void> {
    const sql = `UPDATE refresh_tokens SET revoked = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`;
    await this.db.query(sql, [id]);
  }

  async revokeFamily(familyId: string): Promise<void> {
    const sql = `UPDATE refresh_tokens SET revoked = true, updated_at = CURRENT_TIMESTAMP WHERE family_id = $1`;
    await this.db.query(sql, [familyId]);
  }
}
