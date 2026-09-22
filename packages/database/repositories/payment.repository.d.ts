import { DbClient } from "../db.js";
import { Payment } from "../types/index.js";
export declare class PaymentRepository {
    private readonly db;
    constructor(db: DbClient);
    create(data: Omit<Payment, "id" | "created_at" | "updated_at">): Promise<Payment>;
    findByEscrowId(escrowId: string): Promise<Payment[]>;
    findByProviderReference(provider: string, ref: string): Promise<Payment | null>;
}
//# sourceMappingURL=payment.repository.d.ts.map