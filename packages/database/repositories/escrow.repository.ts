import {
  EscrowStatus,
  StateTransitionParams,
  executeTransition,
} from "@escrow-ecuador/domain";
import { DbClient } from "../db.js";
import { EscrowTransaction } from "../types/index.js";

export class EscrowRepository {
  constructor(private readonly db: DbClient) {}

  async create(
    data: Omit<EscrowTransaction, "id" | "created_at" | "updated_at">,
  ): Promise<EscrowTransaction> {
    const amountNum = parseFloat(data.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error("Escrow amount must be positive");
    }

    const id = crypto.randomUUID();
    const now = new Date();
    const formattedAmount = amountNum.toFixed(2);

    const sql = `
      INSERT INTO escrow_transactions (
        id, external_reference, buyer_id, seller_id, amount, currency, status, description, expires_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const params = [
      id,
      data.external_reference,
      data.buyer_id,
      data.seller_id,
      formattedAmount,
      data.currency ?? "USD",
      data.status ?? EscrowStatus.CREATED,
      data.description ?? null,
      data.expires_at ?? null,
      now,
      now,
    ];

    const res = await this.db.query<EscrowTransaction>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to create escrow transaction record");
  }

  async findById(id: string): Promise<EscrowTransaction | null> {
    const sql = `SELECT * FROM escrow_transactions WHERE id = $1`;
    const res = await this.db.query<EscrowTransaction>(sql, [id]);
    return res.rows[0] ?? null;
  }

  async findByExternalReference(
    ref: string,
  ): Promise<EscrowTransaction | null> {
    const sql = `SELECT * FROM escrow_transactions WHERE external_reference = $1`;
    const res = await this.db.query<EscrowTransaction>(sql, [ref]);
    return res.rows[0] ?? null;
  }

  async transitionStatus(
    params: StateTransitionParams,
  ): Promise<EscrowTransaction> {
    // 1. Validate transition using domain state machine
    const validatedTransition = executeTransition(params);

    // 2. Persist state change
    const now = new Date(validatedTransition.timestamp);
    const sql = `
      UPDATE escrow_transactions
      SET status = $1, updated_at = $2
      WHERE id = $3 AND status = $4
      RETURNING *
    `;

    const res = await this.db.query<EscrowTransaction>(sql, [
      validatedTransition.newState,
      now,
      validatedTransition.transactionId,
      validatedTransition.previousState,
    ]);

    if (res.rows.length > 0) return res.rows[0];

    throw new Error(
      `Failed to transition escrow transaction ${validatedTransition.transactionId} from ${validatedTransition.previousState} to ${validatedTransition.newState}`,
    );
  }
}
