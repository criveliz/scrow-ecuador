import { DbClient } from "../db.js";
import { AuthRefreshToken } from "../types/index.js";
import crypto from "crypto";

export class RefreshTokenRepository {
  constructor(private readonly db: DbClient) {}

  async create(
    userId: string,
    tokenHash: string,
    familyId: string,
    expiresAt: Date,
    client: DbClient = this.db,
  ): Promise<AuthRefreshToken> {
    const id = crypto.randomUUID();
    const sql = `
      INSERT INTO auth_refresh_tokens (id, user_id, token_hash, family_id, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const params = [id, userId, tokenHash, familyId, expiresAt];
    const res = await client.query<AuthRefreshToken>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to create refresh token record");
  }

  async findByHashForUpdate(
    tokenHash: string,
    client: DbClient = this.db,
  ): Promise<AuthRefreshToken | null> {
    const sql = `
      SELECT * FROM auth_refresh_tokens
      WHERE token_hash = $1
      FOR UPDATE
    `;
    const res = await client.query<AuthRefreshToken>(sql, [tokenHash]);
    return res.rows[0] ?? null;
  }

  async revokeFamily(
    familyId: string,
    client: DbClient = this.db,
  ): Promise<void> {
    const sql = `
      UPDATE auth_refresh_tokens
      SET is_revoked = TRUE
      WHERE family_id = $1
    `;
    await client.query(sql, [familyId]);
  }

  async revoke(tokenHash: string, client: DbClient = this.db): Promise<void> {
    const sql = `
      UPDATE auth_refresh_tokens
      SET is_revoked = TRUE
      WHERE token_hash = $1
    `;
    await client.query(sql, [tokenHash]);
  }
}
