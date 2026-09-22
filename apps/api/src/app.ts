import { IncomingMessage, ServerResponse } from "http";
import { ActorRole } from "@escrow-ecuador/domain";
import {
  AuditLogRepository,
  DbClient,
  DisputeRepository,
  EscrowRepository,
  LedgerRepository,
  PaymentRepository,
  ReleaseRepository,
  UserRepository,
} from "@escrow-ecuador/database";
import { FiduciaryProvider, PaymentProvider } from "@escrow-ecuador/providers";
import { FiduciaryReconciliationService } from "./reconciliation/reconciliation.service.js";
import { RefundService } from "./refunds/refund.service.js";
import { ReleaseService } from "./releases/release.service.js";

export interface AppDependencies {
  db: DbClient;
  fiduciaryProvider: FiduciaryProvider;
  paymentProvider: PaymentProvider;
}

export class EscrowApiApp {
  public escrowRepo: EscrowRepository;
  public paymentRepo: PaymentRepository;
  public releaseRepo: ReleaseRepository;
  public disputeRepo: DisputeRepository;
  public auditRepo: AuditLogRepository;
  public ledgerRepo: LedgerRepository;
  public userRepo: UserRepository;
  public releaseService: ReleaseService;
  public refundService: RefundService;
  public reconciliationService: FiduciaryReconciliationService;

  constructor(deps: AppDependencies) {
    this.escrowRepo = new EscrowRepository(deps.db);
    this.paymentRepo = new PaymentRepository(deps.db);
    this.releaseRepo = new ReleaseRepository(deps.db);
    this.disputeRepo = new DisputeRepository(deps.db);
    this.auditRepo = new AuditLogRepository(deps.db);
    this.ledgerRepo = new LedgerRepository(deps.db);
    this.userRepo = new UserRepository(deps.db);

    this.releaseService = new ReleaseService(
      deps.db,
      this.escrowRepo,
      this.paymentRepo,
      this.releaseRepo,
      this.disputeRepo,
      this.auditRepo,
      this.ledgerRepo,
      deps.fiduciaryProvider
    );

    this.refundService = new RefundService(
      deps.db,
      this.escrowRepo,
      this.paymentRepo,
      this.releaseRepo,
      this.disputeRepo,
      this.auditRepo,
      this.ledgerRepo,
      deps.paymentProvider,
      deps.fiduciaryProvider
    );

    this.reconciliationService = new FiduciaryReconciliationService(
      deps.db,
      this.escrowRepo,
      this.releaseRepo,
      this.ledgerRepo,
      this.auditRepo,
      deps.fiduciaryProvider
    );
  }

  async handleRequest(
    method: string,
    pathName: string,
    headers: Record<string, string | string[] | undefined>,
    body: Record<string, unknown> = {}
  ): Promise<{ statusCode: number; body: Record<string, unknown> }> {
    try {
      const findHeader = (name: string) => {
        const lowerName = name.toLowerCase();
        for (const [k, v] of Object.entries(headers)) {
          if (k.toLowerCase() === lowerName) return v as string;
        }
        return undefined;
      };

      const userId = (findHeader("x-user-id") as string | undefined) ?? (body.actorId as string | undefined);
      const rawRole = findHeader("x-user-role") ?? body.actorRole ?? "BUYER";
      const userRoleStr = String(rawRole).toUpperCase();
      const validRoles = ["BUYER", "SELLER", "SUPPORT", "ADMIN", "SUPER_ADMIN", "SYSTEM"];
      const userRole = (validRoles.includes(userRoleStr)
        ? userRoleStr
        : "BUYER") as ActorRole;

      const idempotencyKey =
        (findHeader("x-idempotency-key") as string) ?? (body.idempotencyKey as string) ?? (body.idempotency_key as string);

      // POST /api/v1/escrows/:id/release
      const releaseMatch = pathName.match(/^\/api\/v1\/escrows\/([a-zA-Z0-9-]+)\/release$/);
      if (method === "POST" && releaseMatch) {
        const escrowId = releaseMatch[1];
        if (!userId) {
          return { statusCode: 401, body: { error: "UNAUTHORIZED: Missing x-user-id header" } };
        }
        const result = await this.releaseService.requestRelease({
          escrowId,
          actorId: userId,
          actorRole: userRole,
          idempotencyKey,
          requestedAmount: body.amount as string | undefined,
          recipientReference: body.recipientReference as string | undefined,
          isDisputeOverride: Boolean(body.isDisputeOverride),
        });
        return { statusCode: 200, body: { success: true, ...result } };
      }

      // GET /api/v1/releases/:id
      const getReleaseMatch = pathName.match(/^\/api\/v1\/releases\/([a-zA-Z0-9-]+)$/);
      if (method === "GET" && getReleaseMatch) {
        const releaseId = getReleaseMatch[1];
        if (!userId) {
          return { statusCode: 401, body: { error: "UNAUTHORIZED: Missing x-user-id header" } };
        }
        const release = await this.releaseService.getRelease(releaseId, userId, userRole);
        return { statusCode: 200, body: { success: true, release } };
      }

      // POST /api/v1/releases/:id/retry
      const retryReleaseMatch = pathName.match(/^\/api\/v1\/releases\/([a-zA-Z0-9-]+)\/retry$/);
      if (method === "POST" && retryReleaseMatch) {
        const releaseId = retryReleaseMatch[1];
        if (!userId) {
          return { statusCode: 401, body: { error: "UNAUTHORIZED: Missing x-user-id header" } };
        }
        const release = await this.releaseService.retryRelease(releaseId, userId, userRole);
        return { statusCode: 200, body: { success: true, release } };
      }

      // POST /api/v1/payments/:id/refund
      const refundMatch = pathName.match(/^\/api\/v1\/payments\/([a-zA-Z0-9-]+)\/refund$/);
      if (method === "POST" && refundMatch) {
        const paymentId = refundMatch[1];
        if (!userId) {
          return { statusCode: 401, body: { error: "UNAUTHORIZED: Missing x-user-id header" } };
        }
        let escrowId = (body.escrowId as string) ?? (body.escrow_id as string);
        if (!escrowId) {
          const payments = await this.paymentRepo.findByEscrowId(paymentId);
          if (payments.length > 0) {
            escrowId = payments[0].escrow_id;
          } else {
            const esc = await this.escrowRepo.findById(paymentId);
            if (esc) escrowId = esc.id;
          }
        }
        if (!escrowId) {
          return { statusCode: 400, body: { error: "escrowId is required for refund" } };
        }

        const result = await this.refundService.requestRefund({
          escrowId,
          paymentId,
          actorId: userId,
          actorRole: userRole,
          idempotencyKey,
          amount: body.amount as string | undefined,
          reason: body.reason as string | undefined,
          isDisputeOverride: Boolean(body.isDisputeOverride),
        });
        return { statusCode: 200, body: { success: true, ...result } };
      }

      // GET /api/v1/refunds/:id
      const getRefundMatch = pathName.match(/^\/api\/v1\/refunds\/([a-zA-Z0-9-]+)$/);
      if (method === "GET" && getRefundMatch) {
        const refundId = getRefundMatch[1];
        if (!userId) {
          return { statusCode: 401, body: { error: "UNAUTHORIZED: Missing x-user-id header" } };
        }
        const refund = await this.refundService.getRefund(refundId, userId, userRole);
        return { statusCode: 200, body: { success: true, refund } };
      }

      // POST /api/v1/releases/:id/reconcile
      const reconcileReleaseMatch = pathName.match(/^\/api\/v1\/releases\/([a-zA-Z0-9-]+)\/reconcile$/);
      if (method === "POST" && reconcileReleaseMatch) {
        const releaseId = reconcileReleaseMatch[1];
        if (!userId) {
          return { statusCode: 401, body: { error: "UNAUTHORIZED: Missing x-user-id header" } };
        }
        const release = await this.reconciliationService.reconcileRelease(releaseId, userId, userRole);
        return { statusCode: 200, body: { success: true, release } };
      }

      return { statusCode: 404, body: { error: `Route not found: ${method} ${pathName}` } };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      let statusCode = 400;
      if (message.includes("UNAUTHORIZED") || message.includes("IDOR_VIOLATION") || message.includes("FORBIDDEN_ROLE")) {
        statusCode = 403;
      } else if (message.includes("not found")) {
        statusCode = 404;
      }
      return { statusCode, body: { success: false, error: message } };
    }
  }

  public async httpHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    let bodyData = "";

    req.on("data", (chunk) => {
      bodyData += chunk;
    });

    req.on("end", async () => {
      let body: Record<string, unknown> = {};
      if (bodyData.trim()) {
        try {
          body = JSON.parse(bodyData);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
      }

      const headers: Record<string, string | string[] | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k.toLowerCase()] = v;
      }

      const response = await this.handleRequest(req.method ?? "GET", url.pathname, headers, body);
      res.writeHead(response.statusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response.body));
    });
  }
}
