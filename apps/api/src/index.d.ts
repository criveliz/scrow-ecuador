import { IncomingMessage, ServerResponse } from "http";
import { AuditLogRepository, DisputeRepository, EscrowRepository, IdempotencyRepository, PgMemDbClient, RefreshTokenRepository, UserRepository } from "@escrow-ecuador/database";
import { AuthService } from "./auth/auth.service.js";
import { EscrowService } from "./escrow/escrow.service.js";
export declare function createApiServer(dbClient?: PgMemDbClient): {
    server: import("node:http").Server<typeof IncomingMessage, typeof ServerResponse>;
    db: PgMemDbClient;
    userRepo: UserRepository;
    refreshTokenRepo: RefreshTokenRepository;
    escrowRepo: EscrowRepository;
    auditLogRepo: AuditLogRepository;
    disputeRepo: DisputeRepository;
    idempotencyRepo: IdempotencyRepository;
    authService: AuthService;
    escrowService: EscrowService;
};
//# sourceMappingURL=index.d.ts.map