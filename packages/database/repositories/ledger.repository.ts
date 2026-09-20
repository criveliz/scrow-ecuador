import { DbClient } from "../db.js";
import {
  LedgerAccount,
  LedgerDirection,
  LedgerEntry,
  LedgerTransaction,
} from "../types/index.js";

/**
 * Converts a monetary string (e.g. "123.45") into BigInt cents (12345n)
 * without floating-point binary conversion errors.
 */
function parseAmountToCents(amountStr: string): bigint {
  const trimmed = amountStr.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error(`Invalid monetary amount format: '${amountStr}'`);
  }
  const [dollars, cents = ""] = trimmed.split(".");
  const paddedCents = cents.padEnd(2, "0");
  return BigInt(dollars) * 100n + BigInt(paddedCents);
}

export class LedgerRepository {
  constructor(private readonly db: DbClient) {}

  async createAccount(
    data: Omit<LedgerAccount, "id" | "created_at" | "updated_at">
  ): Promise<LedgerAccount> {
    const id = crypto.randomUUID();
    const now = new Date();

    const sql = `
      INSERT INTO ledger_accounts (id, name, code, type, description, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const params = [id, data.name, data.code, data.type, data.description ?? null, now, now];

    const res = await this.db.query<LedgerAccount>(sql, params);
    if (res.rows.length > 0) return res.rows[0];

    throw new Error("Failed to create ledger account");
  }

  async findAccountByName(name: string): Promise<LedgerAccount | null> {
    const sql = `SELECT * FROM ledger_accounts WHERE name = $1`;
    const res = await this.db.query<LedgerAccount>(sql, [name]);
    return res.rows[0] ?? null;
  }

  /**
   * Posts a double-entry ledger transaction.
   * Enforces exact decimal balancing using BigInt integer-cents arithmetic.
   * Note: Ledger records are append-only. No UPDATE or DELETE methods exist.
   */
  async postTransaction(
    txData: Omit<LedgerTransaction, "id" | "created_at">,
    entriesData: Array<Omit<LedgerEntry, "id" | "ledger_transaction_id" | "created_at">>
  ): Promise<{ transaction: LedgerTransaction; entries: LedgerEntry[] }> {
    if (entriesData.length < 2) {
      throw new Error("Double-entry transaction must contain at least 2 entries");
    }

    // Double-entry validation: Total Debits must equal Total Credits using BigInt cents
    let totalDebitCents = 0n;
    let totalCreditCents = 0n;

    for (const entry of entriesData) {
      const amountCents = parseAmountToCents(entry.amount);
      if (amountCents <= 0n) {
        throw new Error("Ledger entry amount must be positive");
      }

      if (entry.direction === LedgerDirection.DEBIT) {
        totalDebitCents += amountCents;
      } else if (entry.direction === LedgerDirection.CREDIT) {
        totalCreditCents += amountCents;
      } else {
        throw new Error(`Invalid ledger entry direction: ${entry.direction}`);
      }
    }

    if (totalDebitCents !== totalCreditCents) {
      const debitStr = (Number(totalDebitCents) / 100).toFixed(2);
      const creditStr = (Number(totalCreditCents) / 100).toFixed(2);
      throw new Error(
        `Unbalanced double-entry transaction! Debits (${debitStr}) != Credits (${creditStr})`
      );
    }

    return await this.db.transaction(async (txClient) => {
      const txId = crypto.randomUUID();
      const now = new Date();

      const txSql = `
        INSERT INTO ledger_transactions (id, escrow_id, type, reference, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      const txParams = [
        txId,
        txData.escrow_id ?? null,
        txData.type,
        txData.reference,
        txData.status ?? "POSTED",
        now,
      ];

      const txRes = await txClient.query<LedgerTransaction>(txSql, txParams);
      if (txRes.rows.length === 0) {
        throw new Error("Failed to insert ledger transaction record");
      }
      const postedTx = txRes.rows[0];

      const postedEntries: LedgerEntry[] = [];

      for (const entryData of entriesData) {
        const entryId = crypto.randomUUID();
        const amountCents = parseAmountToCents(entryData.amount);
        const formattedAmount = (Number(amountCents) / 100).toFixed(2);

        const entrySql = `
          INSERT INTO ledger_entries (id, ledger_transaction_id, ledger_account_id, direction, amount, currency, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `;
        const entryParams = [
          entryId,
          txId,
          entryData.ledger_account_id,
          entryData.direction,
          formattedAmount,
          entryData.currency ?? "USD",
          now,
        ];

        const entryRes = await txClient.query<LedgerEntry>(entrySql, entryParams);
        if (entryRes.rows.length === 0) {
          throw new Error("Failed to insert ledger entry record");
        }
        postedEntries.push(entryRes.rows[0]);
      }

      return { transaction: postedTx, entries: postedEntries };
    });
  }

  async findEntriesByTransactionId(transactionId: string): Promise<LedgerEntry[]> {
    const sql = `SELECT * FROM ledger_entries WHERE ledger_transaction_id = $1`;
    const res = await this.db.query<LedgerEntry>(sql, [transactionId]);
    return res.rows;
  }
}
