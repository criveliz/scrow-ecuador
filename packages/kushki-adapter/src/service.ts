import { KushkiClient, KushkiChargeRequest, KushkiResponse } from "./client.js";
import { EscrowStatus } from "@escrow-ecuador/domain";
import { DbClient } from "@escrow-ecuador/database";

export interface ChargeResult {
  paymentId: string;
  ticketNumber: string | null;
  status: string;
  actionUrl: string | null;
}

export class KushkiPaymentService {
  constructor(
    private readonly kushkiClient: KushkiClient,
    private readonly db: DbClient
  ) {}

  async processCardCharge(
    escrowId: string,
    buyerId: string,
    token: string,
    idempotencyKey: string
  ): Promise<ChargeResult> {
    const initialResult = await this.db.transaction(async (tx: DbClient) => {
      const idempSql = `SELECT * FROM payment_transactions WHERE idempotency_key = $1`;
      const idempRes = await tx.query(idempSql, [idempotencyKey]);
      if (idempRes.rows.length > 0) {
        return { existing: idempRes.rows[0] };
      }

      const escrowSql = `SELECT * FROM escrow_transactions WHERE id = $1`;
      const escrowRes = await tx.query(escrowSql, [escrowId]);
      const escrow = escrowRes.rows[0];

      if (!escrow) {
        throw new Error("Escrow transaction not found");
      }

      if (escrow.buyer_id !== buyerId) {
        const err = new Error("Unauthorized caller");
        (err as any).status = 403;
        throw err;
      }

      if (escrow.status !== EscrowStatus.AWAITING_PAYMENT) {
        const err = new Error("Invalid escrow state for payment");
        (err as any).status = 409;
        throw err;
      }

      const numericAmount = parseFloat(escrow.amount);
      const amountCents = BigInt(Math.round(numericAmount * 100));
      const kushkiAmount = Number(amountCents) / 100;

      const paymentId = crypto.randomUUID();
      const insertSql = `
        INSERT INTO payment_transactions (
          id, escrow_id, gateway, method_type, amount_cents, currency, status, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `;
      await tx.query(insertSql, [
        paymentId,
        escrowId,
        "KUSHKI",
        "CREDIT_CARD",
        amountCents.toString(),
        "USD",
        "INITIALIZED",
        idempotencyKey
      ]);

      return { paymentId, kushkiAmount };
    });

    if (initialResult.existing) {
      const existing = initialResult.existing;
      return {
        paymentId: existing.id,
        ticketNumber: existing.kushki_ticket_number,
        status: existing.status,
        actionUrl: existing.action_url,
      };
    }

    const { paymentId, kushkiAmount } = initialResult;

    let kushkiResponse: KushkiResponse | undefined;
    let error: Error | null = null;
    try {
      const request: KushkiChargeRequest = {
        token,
        amount: {
          subtotalIva0: kushkiAmount!,
          currency: "USD",
        },
      };
      kushkiResponse = await this.kushkiClient.chargeCard(request, idempotencyKey);
    } catch (e: unknown) {
      error = e instanceof Error ? e : new Error(String(e));
    }

    return this.db.transaction(async (tx: DbClient) => {
      if (error) {
        await tx.query(
          `UPDATE payment_transactions SET status = 'FAILED', raw_response = $1, updated_at = $2 WHERE id = $3`,
          [JSON.stringify({ error: error.message }), new Date(), paymentId]
        );
        throw error;
      }

      let newStatus = "PROCESSING";
      let requiresAction = false;
      let actionUrl = null;
      let ticketNumber = kushkiResponse!.ticketNumber || null;

      const is3ds = kushkiResponse!.secureValidation?.type === "REQUIRES_ACTION";

      if (is3ds) {
        newStatus = "PENDING_CHALLENGE";
        requiresAction = true;
        actionUrl = kushkiResponse!.secureValidation?.acsURL || null;
      } else if (kushkiResponse!.details?.responseCode === "000" || kushkiResponse!.status === "APPROVAL") {
        newStatus = "AUTHORIZED";
      } else {
        newStatus = "FAILED";
      }

      await tx.query(
        `UPDATE payment_transactions
         SET status = $1, kushki_ticket_number = $2, requires_action = $3, action_url = $4, raw_response = $5, updated_at = $6
         WHERE id = $7`,
        [newStatus, ticketNumber, requiresAction, actionUrl, JSON.stringify(kushkiResponse), new Date(), paymentId]
      );

      return {
        paymentId: paymentId!,
        ticketNumber,
        status: newStatus,
        actionUrl,
      };
    });
  }
}
