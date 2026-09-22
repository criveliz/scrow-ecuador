import { StateTransitionParams } from "@escrow-ecuador/domain";
import { DbClient } from "../db.js";
import { EscrowTransaction } from "../types/index.js";
export declare class EscrowRepository {
    private readonly db;
    constructor(db: DbClient);
    create(data: Omit<EscrowTransaction, "id" | "created_at" | "updated_at">): Promise<EscrowTransaction>;
    findById(id: string): Promise<EscrowTransaction | null>;
    findByExternalReference(ref: string): Promise<EscrowTransaction | null>;
    transitionStatus(params: StateTransitionParams): Promise<EscrowTransaction>;
}
//# sourceMappingURL=escrow.repository.d.ts.map