import { DbClient } from "../db.js";
export declare function seedDatabase(db: DbClient): Promise<{
    buyer: import("../types/index.js").User;
    seller: import("../types/index.js").User;
    sampleEscrow: import("../types/index.js").EscrowTransaction;
}>;
//# sourceMappingURL=seed.d.ts.map