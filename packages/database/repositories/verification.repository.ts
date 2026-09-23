import { DbClient } from "../db.js";
import { VerificationRecord } from "../types/index.js";

export class VerificationRepository {
  constructor(private readonly db: DbClient) {}

  async create(
    data: Omit<VerificationRecord, "id" | "created_at" | "updated_at">,
  ): Promise<VerificationRecord> {
    const id = crypto.randomUUID();
    const now = new Date();

    const sql = `
      INSERT INTO verifications (
        id, escrow_id, party_id, provider, verification_type, status,
        provider_reference, request_hash, response_hash, verified_at,
        cost_tokens, raw_response_location, raw_response, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `;

    const params = [
      id,
      data.escrow_id ?? null,
      data.party_id ?? null,
      data.provider,
      data.verification_type,
      data.status ?? "PENDING",
      data.provider_reference ?? null,
      data.request_hash ?? null,
      data.response_hash ?? null,
      data.verified_at ?? null,
      data.cost_tokens ?? 0,
      data.raw_response_location ?? null,
      data.raw_response ? JSON.stringify(data.raw_response) : null,
      now,
      now,
    ];

    const res = await this.db.query<VerificationRecord>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to create verification record");
  }

  async findById(id: string): Promise<VerificationRecord | null> {
    const sql = `SELECT * FROM verifications WHERE id = $1`;
    const res = await this.db.query<VerificationRecord>(sql, [id]);
    return res.rows[0] ?? null;
  }

  async findByEscrowId(escrowId: string): Promise<VerificationRecord[]> {
    const sql = `SELECT * FROM verifications WHERE escrow_id = $1 ORDER BY created_at DESC`;
    const res = await this.db.query<VerificationRecord>(sql, [escrowId]);
    return res.rows;
  }

  async findByPartyId(partyId: string): Promise<VerificationRecord[]> {
    const sql = `SELECT * FROM verifications WHERE party_id = $1 ORDER BY created_at DESC`;
    const res = await this.db.query<VerificationRecord>(sql, [partyId]);
    return res.rows;
  }

  async findByProviderReference(
    providerReference: string,
  ): Promise<VerificationRecord | null> {
    const sql = `SELECT * FROM verifications WHERE provider_reference = $1 ORDER BY created_at DESC LIMIT 1`;
    const res = await this.db.query<VerificationRecord>(sql, [
      providerReference,
    ]);
    return res.rows[0] ?? null;
  }

  async updateStatus(
    id: string,
    status: string,
    providerReference?: string | null,
    verifiedAt?: Date | string | null,
    rawResponse?: Record<string, unknown> | null,
    responseHash?: string | null,
  ): Promise<VerificationRecord> {
    const now = new Date();
    const sql = `
      UPDATE verifications
      SET status = $2,
          provider_reference = COALESCE($3, provider_reference),
          verified_at = COALESCE($4, verified_at),
          raw_response = COALESCE($5, raw_response),
          response_hash = COALESCE($6, response_hash),
          updated_at = $7
      WHERE id = $1
      RETURNING *
    `;

    const params = [
      id,
      status,
      providerReference ?? null,
      verifiedAt ?? null,
      rawResponse ? JSON.stringify(rawResponse) : null,
      responseHash ?? null,
      now,
    ];

    const res = await this.db.query<VerificationRecord>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error(`Verification record with id ${id} not found`);
  }
}
