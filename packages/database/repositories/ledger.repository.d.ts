import { DbClient } from "../db.js";
import { LedgerAccount, LedgerEntry, LedgerTransaction } from "../types/index.js";
export declare class LedgerRepository {
    private readonly db;
    constructor(db: DbClient);
    createAccount(data: Omit<LedgerAccount, "id" | "created_at" | "updated_at">): Promise<LedgerAccount>;
    findAccountByName(name: string): Promise<LedgerAccount | null>;
    /**
     * Posts a double-entry ledger transaction.
     * Enforces exact decimal balancing using BigInt integer-cents arithmetic.
     * Note: Ledger records are append-only. No UPDATE or DELETE methods exist.
     */
    postTransaction(txData: Omit<LedgerTransaction, "id" | "created_at">, entriesData: Array<Omit<LedgerEntry, "id" | "ledger_transaction_id" | "created_at">>): Promise<{
        transaction: LedgerTransaction;
        entries: LedgerEntry[];
    }>;
    findEntriesByTransactionId(transactionId: string): Promise<LedgerEntry[]>;
}
//# sourceMappingURL=ledger.repository.d.ts.map