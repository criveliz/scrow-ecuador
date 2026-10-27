import { Pool, PoolClient } from "pg";
import { CreateEscrowInput, TransitionActionInput } from "./schemas.js";
import { EscrowStatus, EscrowTransaction, VALID_TRANSITIONS } from "./types.js";

export class EscrowError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "EscrowError";
  }
}

export class EscrowService {
  constructor(private pool: Pool) {}

  async createEscrow(
    buyerId: string,
    input: CreateEscrowInput,
    idempotencyKey?: string,
  ): Promise<EscrowTransaction> {
    if (buyerId === input.sellerId) {
      throw new EscrowError(
        "INVALID_COUNTERPARTY",
        "Buyer and seller must be different",
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      if (idempotencyKey) {
        const existing = await client.query(
          "SELECT * FROM escrow_transactions WHERE idempotency_key = $1",
          [idempotencyKey],
        );
        if (existing.rows.length > 0) {
          await client.query("ROLLBACK");
          return existing.rows[0] as EscrowTransaction;
        }
      }

      const insertQuery = `
        INSERT INTO escrow_transactions (
          buyer_id, seller_id, arbitrator_id, amount_cents, fee_cents,
          currency, status, description, terms, idempotency_key
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `;
      const values = [
        buyerId,
        input.sellerId,
        input.arbitratorId || null,
        input.amountCents, // BigInt will be handled by pg driver natively since it's INT8, but we pass as number/string here
        input.feeCents,
        input.currency,
        EscrowStatus.AWAITING_PAYMENT,
        input.description,
        input.terms,
        idempotencyKey || null,
      ];

      const res = await client.query(insertQuery, values);
      const escrow = res.rows[0] as EscrowTransaction;

      await client.query(
        `INSERT INTO escrow_audit_ledger (
          escrow_id, from_status, to_status, actor_id, action, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          escrow.id,
          EscrowStatus.DRAFT,
          EscrowStatus.AWAITING_PAYMENT,
          buyerId,
          "INITIATE_ESCROW",
          {},
        ],
      );

      await client.query("COMMIT");
      return escrow;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async transitionStatus(
    escrowId: string,
    targetStatus: EscrowStatus,
    actorId: string,
    actorRole: string,
    action: string,
    input?: TransitionActionInput,
  ): Promise<EscrowTransaction> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const res = await client.query(
        "SELECT * FROM escrow_transactions WHERE id = $1 FOR UPDATE",
        [escrowId],
      );

      if (res.rows.length === 0) {
        throw new EscrowError(
          "ESCROW_NOT_FOUND",
          "Escrow transaction not found",
        );
      }

      const escrow = res.rows[0] as EscrowTransaction;
      const currentStatus = escrow.status;

      if (!VALID_TRANSITIONS[currentStatus].includes(targetStatus)) {
        throw new EscrowError(
          "ILLEGAL_STATE_TRANSITION",
          `Cannot transition from ${currentStatus} to ${targetStatus}`,
        );
      }

      this.enforceAuthority(escrow, targetStatus, actorId, actorRole);

      let updateQuery = `
        UPDATE escrow_transactions
        SET status = $1, version = version + 1, updated_at = NOW()
      `;
      const values: any[] = [targetStatus, escrowId];
      let paramCount = 2;

      if (targetStatus === EscrowStatus.FUNDS_HELD) {
        updateQuery += `, funded_at = NOW()`;
      } else if (
        [
          EscrowStatus.RELEASED,
          EscrowStatus.REFUNDED,
          EscrowStatus.CANCELLED,
        ].includes(targetStatus)
      ) {
        updateQuery += `, closed_at = NOW()`;
      }

      updateQuery += ` WHERE id = $2 RETURNING *`;

      const updateRes = await client.query(updateQuery, values);
      const updatedEscrow = updateRes.rows[0] as EscrowTransaction;

      await client.query(
        `INSERT INTO escrow_audit_ledger (
          escrow_id, from_status, to_status, actor_id, action, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          escrow.id,
          currentStatus,
          targetStatus,
          actorId,
          action,
          input?.metadata || {},
        ],
      );

      await client.query("COMMIT");
      return updatedEscrow;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  private enforceAuthority(
    escrow: EscrowTransaction,
    targetStatus: EscrowStatus,
    actorId: string,
    actorRole: string,
  ) {
    if (actorRole === "admin" || actorRole === "internal_service") return;

    const isBuyer = actorId === escrow.buyer_id;
    const isSeller = actorId === escrow.seller_id;
    const isArbitrator = actorId === escrow.arbitrator_id;

    if (targetStatus === EscrowStatus.FUNDS_HELD) {
      throw new EscrowError(
        "AUTHORITY_ERROR",
        "Only admin or internal service can set FUNDS_HELD",
      );
    }

    if (targetStatus === EscrowStatus.RELEASED) {
      if (escrow.status === EscrowStatus.DISPUTED) {
        if (!isArbitrator) {
          throw new EscrowError(
            "AUTHORITY_ERROR",
            "Only arbitrator can release disputed funds",
          );
        }
      } else {
        if (!isBuyer) {
          throw new EscrowError(
            "AUTHORITY_ERROR",
            "Only buyer can release undisputed funds",
          );
        }
      }
    }

    if (targetStatus === EscrowStatus.REFUNDED) {
      if (escrow.status === EscrowStatus.DISPUTED) {
        if (!isArbitrator) {
          throw new EscrowError(
            "AUTHORITY_ERROR",
            "Only arbitrator can refund disputed funds",
          );
        }
      } else {
        if (!isSeller) {
          throw new EscrowError(
            "AUTHORITY_ERROR",
            "Only seller can refund undisputed funds",
          );
        }
      }
    }

    if (targetStatus === EscrowStatus.DISPUTED) {
      if (!isBuyer && !isSeller) {
        throw new EscrowError(
          "AUTHORITY_ERROR",
          "Only buyer or seller can dispute",
        );
      }
    }

    if (targetStatus === EscrowStatus.CANCELLED) {
      if (
        escrow.status === EscrowStatus.FUNDS_HELD ||
        escrow.status === EscrowStatus.DISPUTED
      ) {
        throw new EscrowError(
          "AUTHORITY_ERROR",
          "Cannot cancel after funds are held",
        );
      }
      if (!isBuyer && !isSeller) {
        throw new EscrowError(
          "AUTHORITY_ERROR",
          "Only counterparty can cancel",
        );
      }
    }
  }

  async getEscrowById(
    escrowId: string,
    actorId: string,
    actorRole: string,
  ): Promise<EscrowTransaction> {
    const res = await this.pool.query(
      "SELECT * FROM escrow_transactions WHERE id = $1",
      [escrowId],
    );
    if (res.rows.length === 0) {
      throw new EscrowError("ESCROW_NOT_FOUND", "Escrow transaction not found");
    }
    const escrow = res.rows[0] as EscrowTransaction;

    if (
      actorRole !== "admin" &&
      actorId !== escrow.buyer_id &&
      actorId !== escrow.seller_id &&
      actorId !== escrow.arbitrator_id
    ) {
      throw new EscrowError(
        "FORBIDDEN_RESOURCE",
        "Access denied to this escrow transaction",
      );
    }

    return escrow;
  }
}
