import crypto from "crypto";
import {
  ActorRole,
  EscrowStatus,
  executeTransition,
  InvalidStateTransitionError,
  InvalidTransitionPayloadError,
  TerminalStateError,
  UnauthorizedActorError,
} from "@escrow-ecuador/domain";
import {
  AuditLogRepository,
  DisputeRepository,
  EscrowRepository,
  EscrowTransaction,
  IdempotencyRepository,
  UserRepository,
} from "@escrow-ecuador/database";
import { TokenPayload } from "../auth/jwt.js";
import { isPrivilegedRole } from "../auth/rbac.js";

export const ACTION_TO_STATUS_MAP: Record<string, EscrowStatus> = {
  CREATE_ESCROW: EscrowStatus.CREATED,
  PROCEED_TO_PAYMENT: EscrowStatus.AWAITING_PAYMENT,
  START_PAYMENT: EscrowStatus.AWAITING_PAYMENT,
  ACCEPT_ESCROW: EscrowStatus.SELLER_ACCEPTED,
  SELLER_ACCEPT: EscrowStatus.SELLER_ACCEPTED,
  MARK_DELIVERY_PENDING: EscrowStatus.DELIVERY_PENDING,
  MARK_DELIVERED: EscrowStatus.DELIVERED,
  BUYER_CONFIRM: EscrowStatus.BUYER_CONFIRMED,
  CONFIRM_DELIVERY: EscrowStatus.BUYER_CONFIRMED,
  REQUEST_RELEASE: EscrowStatus.RELEASE_PENDING,
  OPEN_DISPUTE: EscrowStatus.DISPUTED,
  CANCEL_ESCROW: EscrowStatus.CANCELLED,
  CANCEL: EscrowStatus.CANCELLED,
  REQUEST_REFUND: EscrowStatus.REFUNDED,
};

export class EscrowServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string
  ) {
    super(message);
    this.name = "EscrowServiceError";
  }
}

export class EscrowService {
  constructor(
    private readonly escrowRepo: EscrowRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly disputeRepo: DisputeRepository,
    private readonly userRepo: UserRepository,
    private readonly idempotencyRepo: IdempotencyRepository
  ) {}

  private computeHash(payload: unknown): string {
    return crypto.createHash("sha256").update(JSON.stringify(payload ?? {})).digest("hex");
  }

  private validateAmount(amount: unknown): string {
    if (typeof amount === "number") {
      if (!isFinite(amount) || amount <= 0) {
        throw new EscrowServiceError(400, "BAD_REQUEST", "Escrow amount must be a positive number");
      }
      return amount.toFixed(2);
    }

    if (typeof amount === "string") {
      const trimmed = amount.trim();
      if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
        throw new EscrowServiceError(
          400,
          "BAD_REQUEST",
          "Escrow amount must be a valid positive decimal string with up to 2 decimal places"
        );
      }
      const num = parseFloat(trimmed);
      if (isNaN(num) || num <= 0) {
        throw new EscrowServiceError(400, "BAD_REQUEST", "Escrow amount must be greater than zero");
      }
      return num.toFixed(2);
    }

    throw new EscrowServiceError(400, "BAD_REQUEST", "Escrow amount is required and must be numeric");
  }

  private validateCurrency(currency: unknown): string {
    if (!currency || typeof currency !== "string") {
      return "USD";
    }
    const upper = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(upper)) {
      throw new EscrowServiceError(400, "BAD_REQUEST", "Currency must be a valid 3-letter ISO code");
    }
    return upper;
  }

  private verifyOwnership(escrow: EscrowTransaction, user: TokenPayload): void {
    if (isPrivilegedRole(user.role)) {
      return;
    }
    if (escrow.buyer_id !== user.userId && escrow.seller_id !== user.userId) {
      throw new EscrowServiceError(403, "FORBIDDEN", "You do not have permission to access this escrow operation");
    }
  }

  async createEscrow(
    user: TokenPayload,
    body: Record<string, any>,
    idempotencyKey?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const scope = `create_escrow:${user.userId}`;
    const requestHash = this.computeHash(body);

    if (idempotencyKey) {
      const existingKey = await this.idempotencyRepo.findByKeyAndScope(idempotencyKey, scope);
      if (existingKey) {
        if (existingKey.request_hash && existingKey.request_hash !== requestHash) {
          throw new EscrowServiceError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key provided with different payload"
          );
        }
        return {
          status: existingKey.response_status ?? 201,
          body: (existingKey.response_body as Record<string, unknown>) ?? {},
        };
      }
    }

    // Role check: Only BUYER, SELLER, ADMIN, SUPPORT can create escrows
    if (!["BUYER", "SELLER", "ADMIN", "SUPPORT", "SUPER_ADMIN"].includes(user.role)) {
      throw new EscrowServiceError(403, "FORBIDDEN", `Role '${user.role}' is not allowed to create escrows`);
    }

    const formattedAmount = this.validateAmount(body.amount);
    const currency = this.validateCurrency(body.currency);

    let buyerId: string;
    let sellerId: string;

    if (user.role === ActorRole.BUYER) {
      buyerId = user.userId;
      sellerId = body.seller_id || body.sellerId;
      if (!sellerId) {
        throw new EscrowServiceError(400, "BAD_REQUEST", "seller_id is required when creating an escrow as BUYER");
      }
    } else if (user.role === ActorRole.SELLER) {
      sellerId = user.userId;
      buyerId = body.buyer_id || body.buyerId;
      if (!buyerId) {
        throw new EscrowServiceError(400, "BAD_REQUEST", "buyer_id is required when creating an escrow as SELLER");
      }
    } else {
      buyerId = body.buyer_id || body.buyerId;
      sellerId = body.seller_id || body.sellerId;
      if (!buyerId || !sellerId) {
        throw new EscrowServiceError(400, "BAD_REQUEST", "buyer_id and seller_id are required");
      }
    }

    if (buyerId === sellerId) {
      throw new EscrowServiceError(400, "BAD_REQUEST", "Buyer and seller cannot be the same user");
    }

    const buyerUser = await this.userRepo.findById(buyerId);
    if (!buyerUser) {
      throw new EscrowServiceError(404, "NOT_FOUND", `Buyer user with ID ${buyerId} not found`);
    }

    const sellerUser = await this.userRepo.findById(sellerId);
    if (!sellerUser) {
      throw new EscrowServiceError(404, "NOT_FOUND", `Seller user with ID ${sellerId} not found`);
    }

    const externalRef = body.external_reference || body.externalReference || `ESC-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const description = body.description ? String(body.description).trim() : null;

    const escrow = await this.escrowRepo.create({
      external_reference: externalRef,
      buyer_id: buyerId,
      seller_id: sellerId,
      amount: formattedAmount,
      currency,
      status: EscrowStatus.CREATED,
      description,
      expires_at: body.expires_at || body.expiresAt || null,
    });

    await this.auditLogRepo.create({
      actor_id: user.userId,
      action: "CREATE_ESCROW",
      entity_type: "escrow",
      entity_id: escrow.id,
      previous_state: null,
      new_state: EscrowStatus.CREATED,
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
      metadata: {
        amount: formattedAmount,
        currency,
        buyer_id: buyerId,
        seller_id: sellerId,
        description,
      },
    });

    const responsePayload = { escrow };

    if (idempotencyKey) {
      await this.idempotencyRepo.saveKey({
        key: idempotencyKey,
        scope,
        requestHash,
        responseStatus: 201,
        responseBody: responsePayload,
      });
    }

    return { status: 201, body: responsePayload };
  }

  async getEscrowById(user: TokenPayload, id: string): Promise<EscrowTransaction> {
    const escrow = await this.escrowRepo.findById(id);
    if (!escrow) {
      throw new EscrowServiceError(404, "NOT_FOUND", `Escrow operation with ID ${id} not found`);
    }

    this.verifyOwnership(escrow, user);
    return escrow;
  }

  async listEscrows(
    user: TokenPayload,
    query: { page?: string; limit?: string }
  ): Promise<{ escrows: EscrowTransaction[]; total: number; page: number; limit: number }> {
    const pageNum = Math.max(1, parseInt(query.page || "1", 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || "10", 10) || 10));

    let escrows: EscrowTransaction[];
    if (isPrivilegedRole(user.role)) {
      escrows = await this.escrowRepo.findAll();
    } else {
      escrows = await this.escrowRepo.findByUserId(user.userId);
    }

    const total = escrows.length;
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedEscrows = escrows.slice(startIndex, startIndex + limitNum);

    return {
      escrows: paginatedEscrows,
      total,
      page: pageNum,
      limit: limitNum,
    };
  }

  async executeAction(
    user: TokenPayload,
    id: string,
    body: Record<string, any>,
    idempotencyKey?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const escrow = await this.escrowRepo.findById(id);
    if (!escrow) {
      throw new EscrowServiceError(404, "NOT_FOUND", `Escrow operation with ID ${id} not found`);
    }

    this.verifyOwnership(escrow, user);

    const action = body.action ? String(body.action).trim().toUpperCase() : null;
    if (!action) {
      throw new EscrowServiceError(400, "BAD_REQUEST", "Action name is required");
    }

    const targetState = ACTION_TO_STATUS_MAP[action] || (Object.values(EscrowStatus).includes(action as EscrowStatus) ? (action as EscrowStatus) : null);
    if (!targetState) {
      throw new EscrowServiceError(400, "BAD_REQUEST", `Unsupported or unrecognized business action '${body.action}'`);
    }

    const scope = `escrow_action:${id}:${user.userId}`;
    const requestHash = this.computeHash(body);

    if (idempotencyKey) {
      const existingKey = await this.idempotencyRepo.findByKeyAndScope(idempotencyKey, scope);
      if (existingKey) {
        if (existingKey.request_hash && existingKey.request_hash !== requestHash) {
          throw new EscrowServiceError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key provided with different payload"
          );
        }
        return {
          status: existingKey.response_status ?? 200,
          body: (existingKey.response_body as Record<string, unknown>) ?? {},
        };
      }
    }

    const actorRole = user.role as ActorRole;
    const reason = body.reason ? String(body.reason).trim() : `Executed action ${action}`;

    let updatedEscrow: EscrowTransaction;
    try {
      updatedEscrow = await this.escrowRepo.transitionStatus({
        transactionId: escrow.id,
        previousState: escrow.status,
        newState: targetState,
        actorId: user.userId,
        actorRole,
        timestamp: new Date(),
        reason,
        metadata: body.metadata,
      });
    } catch (err: any) {
      if (err instanceof UnauthorizedActorError) {
        throw new EscrowServiceError(403, "FORBIDDEN", err.message);
      }
      if (err instanceof InvalidStateTransitionError || err instanceof TerminalStateError) {
        throw new EscrowServiceError(409, "INVALID_STATE_TRANSITION", err.message);
      }
      if (err instanceof InvalidTransitionPayloadError) {
        throw new EscrowServiceError(400, "BAD_REQUEST", err.message);
      }
      throw new EscrowServiceError(400, "BAD_REQUEST", err.message || "Failed to execute transition");
    }

    if (targetState === EscrowStatus.DISPUTED) {
      await this.disputeRepo.create({
        escrow_id: escrow.id,
        opened_by: user.userId,
        reason: reason,
        description: body.description || (body.metadata?.description as string) || null,
        status: "OPEN",
      });
    }

    await this.auditLogRepo.create({
      actor_id: user.userId,
      action,
      entity_type: "escrow",
      entity_id: escrow.id,
      previous_state: escrow.status,
      new_state: updatedEscrow.status,
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
      metadata: {
        reason,
        ...(body.metadata || {}),
      },
    });

    const responsePayload = { escrow: updatedEscrow };

    if (idempotencyKey) {
      await this.idempotencyRepo.saveKey({
        key: idempotencyKey,
        scope,
        requestHash,
        responseStatus: 200,
        responseBody: responsePayload,
      });
    }

    return { status: 200, body: responsePayload };
  }

  async getEscrowHistory(user: TokenPayload, id: string): Promise<{ history: any[] }> {
    const escrow = await this.escrowRepo.findById(id);
    if (!escrow) {
      throw new EscrowServiceError(404, "NOT_FOUND", `Escrow operation with ID ${id} not found`);
    }

    this.verifyOwnership(escrow, user);

    const logs = await this.auditLogRepo.findByEntity("escrow", id);
    return { history: logs };
  }
}
