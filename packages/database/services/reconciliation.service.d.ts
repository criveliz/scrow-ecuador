import { ActorRole } from "@escrow-ecuador/domain";
import { DbClient } from "../db.js";
import { VerifiedKushkiEvent } from "@escrow-ecuador/providers";
export interface ReconciliationResult {
    success: boolean;
    isDuplicate: boolean;
    webhookEventId?: string;
    paymentId?: string;
    escrowId?: string;
    previousPaymentStatus?: string;
    newPaymentStatus?: string;
    previousEscrowStatus?: string;
    newEscrowStatus?: string;
    reconciliationStatus: "SUCCESS" | "DUPLICATE" | "UNMATCHED" | "RECONCILIATION_MISMATCH" | "OUT_OF_ORDER" | "UNKNOWN_EVENT" | "ERROR";
    reason?: string;
}
export declare class ReconciliationService {
    private readonly db;
    private webhookRepo;
    private paymentRepo;
    private escrowRepo;
    private auditRepo;
    constructor(db: DbClient);
    /**
     * Primary entry point for processing Kushki webhooks safely & idempotently.
     */
    processKushkiWebhook(event: VerifiedKushkiEvent, providerName?: string): Promise<ReconciliationResult>;
    /**
     * Internal manual reconciliation service method for operational administrative review.
     */
    reconcilePayment(paymentId: string, actorId: string, actorRole: ActorRole): Promise<ReconciliationResult>;
}
//# sourceMappingURL=reconciliation.service.d.ts.map