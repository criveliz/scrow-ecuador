import { DbClient } from "../db.js";
import { Dispute } from "../types/index.js";
export declare class DisputeRepository {
    private readonly db;
    constructor(db: DbClient);
    create(data: Omit<Dispute, "id" | "created_at" | "updated_at">): Promise<Dispute>;
    findByEscrowId(escrowId: string): Promise<Dispute[]>;
    resolve(id: string, resolvedBy: string, resolution: string, status?: string): Promise<Dispute>;
}
//# sourceMappingURL=dispute.repository.d.ts.map