import { createServer, IncomingMessage, ServerResponse } from "http";
import { URL } from "url";
import {
  AuditLogRepository,
  DisputeRepository,
  EscrowRepository,
  IdempotencyRepository,
  PaymentRepository,
  PgMemDbClient,
  RefreshTokenRepository,
  UserRepository,
  runMigrations,
} from "@escrow-ecuador/database";
import { KushkiPaymentProvider, MockPaymentProvider, PaymentProvider } from "@escrow-ecuador/providers";
import { AuthenticatedRequest } from "./auth/auth.middleware.js";
import { handleAuthRoutes } from "./auth/auth.router.js";
import { AuthService } from "./auth/auth.service.js";
import { handleEscrowRoutes } from "./escrow/escrow.router.js";
import { EscrowService } from "./escrow/escrow.service.js";
import { handlePaymentRoutes } from "./payments/payment.router.js";
import { PaymentService } from "./payments/payment.service.js";

export function createApiServer(
  dbClient?: PgMemDbClient,
  customPaymentProvider?: PaymentProvider
) {
  if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === "")) {
    throw new Error("FATAL: JWT_SECRET environment variable is strictly required in production!");
  }

  const db = dbClient || new PgMemDbClient();
  const userRepo = new UserRepository(db);
  const refreshTokenRepo = new RefreshTokenRepository(db);
  const escrowRepo = new EscrowRepository(db);
  const auditLogRepo = new AuditLogRepository(db);
  const disputeRepo = new DisputeRepository(db);
  const idempotencyRepo = new IdempotencyRepository(db);
  const paymentRepo = new PaymentRepository(db);

  const paymentProvider = customPaymentProvider || (
    process.env.NODE_ENV === "production" || process.env.USE_KUSHKI_PROVIDER === "true"
      ? new KushkiPaymentProvider()
      : new MockPaymentProvider()
  );

  const authService = new AuthService(userRepo, refreshTokenRepo);
  const escrowService = new EscrowService(
    escrowRepo,
    auditLogRepo,
    disputeRepo,
    userRepo,
    idempotencyRepo
  );
  const paymentService = new PaymentService(
    paymentRepo,
    escrowRepo,
    auditLogRepo,
    idempotencyRepo,
    paymentProvider,
    process.env.USE_KUSHKI_PROVIDER === "true" ? "KUSHKI" : "MOCK"
  );

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    const authHandled = handleAuthRoutes(req as AuthenticatedRequest, res, authService, pathname);
    if (authHandled) return;

    const escrowHandled = handleEscrowRoutes(
      req as AuthenticatedRequest,
      res,
      escrowService,
      pathname
    );
    if (escrowHandled) return;

    const paymentHandled = handlePaymentRoutes(
      req as AuthenticatedRequest,
      res,
      paymentService,
      pathname
    );
    if (paymentHandled) return;

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_FOUND", message: `Route ${req.method} ${pathname} not found` }));
  });

  return {
    server,
    db,
    userRepo,
    refreshTokenRepo,
    escrowRepo,
    auditLogRepo,
    disputeRepo,
    idempotencyRepo,
    paymentRepo,
    paymentProvider,
    authService,
    escrowService,
    paymentService,
  };
}

if (process.env.NODE_ENV !== "test" && process.env.START_SERVER === "true") {
  const { server, db } = createApiServer();
  runMigrations(db).then(() => {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`Escrow Ecuador API running on port ${PORT}`);
    });
  });
}
