import { DbClient } from "../db.js";
import {
  LedgerAccount,
  LedgerDirection,
  LedgerEntry,
  LedgerTransaction,
} from "../types/index.js";

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

  async postTransaction(
    txData: Omit<LedgerTransaction, "id" | "created_at">,
    entriesData: Array<Omit<LedgerEntry, "id" | "ledger_transaction_id" | "created_at">>
  ): Promise<{ transaction: LedgerTransaction; entries: LedgerEntry[] }> {
    if (entriesData.length < 2) {
      throw new Error("Double-entry transaction must contain at least 2 entries");
    }

    // Double-entry validation: Total Debits must equal Total Credits
    let totalDebit = 0;
    let totalCredit = 0;

    for (const entry of entriesData) {
      const amount = parseFloat(entry.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error("Ledger entry amount must be positive");
      }

      if (entry.direction === LedgerDirection.DEBIT) {
        totalDebit += amount;
      } else if (entry.direction === LedgerDirection.CREDIT) {
        totalCredit += amount;
      } else {
        throw new Error(`Invalid ledger entry direction: ${entry.direction}`);
      }
    }

    // Fixed precision comparison (2 decimal places)
    const debitFormatted = totalDebit.toFixed(2);
    const creditFormatted = totalCredit.toFixed(2);

    if (debitFormatted !== creditFormatted) {
      throw new Error(
        `Unbalanced double-entry transaction! Debits (${debitFormatted}) != Credits (${creditFormatted})`
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
        const entryAmountFormatted = parseFloat(entryData.amount).toFixed(2);

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
          entryAmountFormatted,
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
