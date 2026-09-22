import { DbClient } from "../db.js";
import { Evidence } from "../types/index.js";
export declare class EvidenceRepository {
    private readonly db;
    constructor(db: DbClient);
    create(data: Omit<Evidence, "id" | "created_at">): Promise<Evidence>;
    findByEscrowId(escrowId: string): Promise<Evidence[]>;
}
//# sourceMappingURL=evidence.repository.d.ts.map