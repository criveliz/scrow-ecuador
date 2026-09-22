import { DbClient } from "../db.js";
import { Refund, Release } from "../types/index.js";
export declare class ReleaseRepository {
    private readonly db;
    constructor(db: DbClient);
    createRelease(data: Omit<Release, "id" | "created_at" | "updated_at">): Promise<Release>;
    createRefund(data: Omit<Refund, "id" | "created_at" | "updated_at">): Promise<Refund>;
    findByEscrowId(escrowId: string): Promise<Release[]>;
    findRefundsByEscrowId(escrowId: string): Promise<Refund[]>;
}
//# sourceMappingURL=release.repository.d.ts.map