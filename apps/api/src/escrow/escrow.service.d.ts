import { EscrowStatus } from "@escrow-ecuador/domain";
import { AuditLogRepository, DisputeRepository, EscrowRepository, EscrowTransaction, IdempotencyRepository, UserRepository } from "@escrow-ecuador/database";
import { TokenPayload } from "../auth/jwt.js";
export declare const ACTION_TO_STATUS_MAP: Record<string, EscrowStatus>;
export declare class EscrowServiceError extends Error {
    readonly statusCode: number;
    readonly errorCode: string;
    constructor(statusCode: number, errorCode: string, message: string);
}
export declare class EscrowService {
    private readonly escrowRepo;
    private readonly auditLogRepo;
    private readonly disputeRepo;
    private readonly userRepo;
    private readonly idempotencyRepo;
    constructor(escrowRepo: EscrowRepository, auditLogRepo: AuditLogRepository, disputeRepo: DisputeRepository, userRepo: UserRepository, idempotencyRepo: IdempotencyRepository);
    private computeHash;
    private validateAmount;
    private validateCurrency;
    private verifyOwnership;
    createEscrow(user: TokenPayload, body: Record<string, any>, idempotencyKey?: string, ipAddress?: string, userAgent?: string): Promise<{
        status: number;
        body: Record<string, unknown>;
    }>;
    getEscrowById(user: TokenPayload, id: string): Promise<EscrowTransaction>;
    listEscrows(user: TokenPayload, query: {
        page?: string;
        limit?: string;
    }): Promise<{
        escrows: EscrowTransaction[];
        total: number;
        page: number;
        limit: number;
    }>;
    executeAction(user: TokenPayload, id: string, body: Record<string, any>, idempotencyKey?: string, ipAddress?: string, userAgent?: string): Promise<{
        status: number;
        body: Record<string, unknown>;
    }>;
    getEscrowHistory(user: TokenPayload, id: string): Promise<{
        history: any[];
    }>;
}
//# sourceMappingURL=escrow.service.d.ts.map