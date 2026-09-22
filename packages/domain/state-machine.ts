export enum EscrowStatus {
  CREATED = "CREATED",
  AWAITING_PAYMENT = "AWAITING_PAYMENT",
  PAYMENT_RECEIVED = "PAYMENT_RECEIVED",
  FUNDS_CONFIRMED = "FUNDS_CONFIRMED",
  SELLER_ACCEPTED = "SELLER_ACCEPTED",
  DELIVERY_PENDING = "DELIVERY_PENDING",
  DELIVERED = "DELIVERED",
  BUYER_CONFIRMED = "BUYER_CONFIRMED",
  RELEASE_PENDING = "RELEASE_PENDING",
  RELEASED = "RELEASED",
  DISPUTED = "DISPUTED",
  REFUNDED = "REFUNDED",
  EXPIRED = "EXPIRED",
  CANCELLED = "CANCELLED",
}

export enum ActorRole {
  BUYER = "BUYER",
  SELLER = "SELLER",
  SUPPORT = "SUPPORT",
  ADMIN = "ADMIN",
  SUPER_ADMIN = "SUPER_ADMIN",
  SYSTEM = "SYSTEM",
}

export interface StateTransitionParams {
  transactionId: string;
  previousState: EscrowStatus;
  newState: EscrowStatus;
  actorId: string;
  actorRole: ActorRole;
  timestamp: Date | string | number;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface EscrowStateTransition {
  transactionId: string;
  previousState: EscrowStatus;
  newState: EscrowStatus;
  actorId: string;
  actorRole: ActorRole;
  timestamp: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

export class InvalidStateTransitionError extends Error {
  constructor(public readonly previousState: EscrowStatus, public readonly newState: EscrowStatus, message?: string) {
    super(message ?? `Invalid escrow state transition from ${previousState} to ${newState}`);
    this.name = "InvalidStateTransitionError";
  }
}

export class UnauthorizedActorError extends Error {
  constructor(
    public readonly actorRole: ActorRole,
    public readonly previousState: EscrowStatus,
    public readonly newState: EscrowStatus,
    message?: string
  ) {
    super(
      message ??
        `Actor role '${actorRole}' is not authorized to transition escrow state from ${previousState} to ${newState}`
    );
    this.name = "UnauthorizedActorError";
  }
}

export class TerminalStateError extends Error {
  constructor(public readonly currentState: EscrowStatus, message?: string) {
    super(message ?? `Cannot transition out of terminal state: ${currentState}`);
    this.name = "TerminalStateError";
  }
}

export class InvalidTransitionPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransitionPayloadError";
  }
}

export const TERMINAL_STATES: ReadonlySet<EscrowStatus> = new Set([
  EscrowStatus.RELEASED,
  EscrowStatus.REFUNDED,
  EscrowStatus.EXPIRED,
  EscrowStatus.CANCELLED,
]);

export const ALLOWED_TRANSITIONS: Record<
  EscrowStatus,
  Partial<Record<EscrowStatus, ActorRole[]>>
> = {
  [EscrowStatus.CREATED]: {
    [EscrowStatus.AWAITING_PAYMENT]: [ActorRole.BUYER, ActorRole.SYSTEM, ActorRole.ADMIN, ActorRole.SUPER_ADMIN],
    [EscrowStatus.CANCELLED]: [ActorRole.BUYER, ActorRole.SELLER, ActorRole.SYSTEM, ActorRole.ADMIN, ActorRole.SUPER_ADMIN],
  },
  [EscrowStatus.AWAITING_PAYMENT]: {
    [EscrowStatus.PAYMENT_RECEIVED]: [ActorRole.SYSTEM, ActorRole.ADMIN, ActorRole.SUPER_ADMIN],
    [EscrowStatus.EXPIRED]: [ActorRole.SYSTEM, ActorRole.ADMIN, ActorRole.SUPER_ADMIN],
    [EscrowStatus.CANCELLED]: [ActorRole.BUYER, ActorRole.SELLER, ActorRole.SYSTEM, ActorRole.ADMIN, ActorRole.SUPER_ADMIN],
  },
  [EscrowStatus.PAYMENT_RECEIVED]: {
    [EscrowStatus.FUNDS_CONFIRMED]: [ActorRole.SYSTEM, ActorRole.ADMIN, ActorRole.SUPER_ADMIN],
    [EscrowStatus.DISPUTED]: [ActorRole.BUYER, ActorRole.SELLER, ActorRole.SYSTEM, ActorRole.ADMIN, ActorRole.SUPER_ADMIN],
  },
  [EscrowStatus.FUNDS_CONFIRMED]: {
    [EscrowStatus.SELLER_ACCEPTED]: [ActorRole.SELLER],
    [EscrowStatus.DISPUTED]: [ActorRole.BUYER, ActorRole.SELLER, ActorRole.SYSTEM, ActorRole.ADMIN, ActorRole.SUPER_ADMIN],
  },
  [EscrowStatus.SELLER_ACCEPTED]: {
    [EscrowStatus.DELIVERY_PENDING]: [ActorRole.SELLER, ActorRole.SYSTEM, ActorRole.ADMIN, ActorRole.SUPER_ADMIN],
    [EscrowStatus.DISPUTED]: [ActorRole.BUYER, ActorRole.SELLER, ActorRole.SYSTEM, ActorRole.ADMIN, ActorRole.SUPER_ADMIN],
  },
  [EscrowStatus.DELIVERY_PENDING]: {
    [EscrowStatus.DELIVERED]: [ActorRole.SELLER, ActorRole.SYSTEM, ActorRole.ADMIN, ActorRole.SUPER_ADMIN],
    [EscrowStatus.DISPUTED]: [ActorRole.BUYER, ActorRole.SELLER, ActorRole.SYSTEM, ActorRole.ADMIN, ActorRole.SUPER_ADMIN],
  },
  [EscrowStatus.DELIVERED]: {
    [EscrowStatus.BUYER_CONFIRMED]: [ActorRole.BUYER],
    [EscrowStatus.DISPUTED]: [ActorRole.BUYER, ActorRole.SELLER, ActorRole.SYSTEM, ActorRole.ADMIN, ActorRole.SUPER_ADMIN],
  },
  [EscrowStatus.BUYER_CONFIRMED]: {
    [EscrowStatus.RELEASE_PENDING]: [ActorRole.BUYER, ActorRole.SYSTEM, ActorRole.ADMIN, ActorRole.SUPER_ADMIN],
  },
  [EscrowStatus.RELEASE_PENDING]: {
    [EscrowStatus.RELEASED]: [ActorRole.SYSTEM, ActorRole.ADMIN, ActorRole.SUPER_ADMIN],
    [EscrowStatus.DISPUTED]: [ActorRole.BUYER, ActorRole.SELLER, ActorRole.SYSTEM, ActorRole.ADMIN, ActorRole.SUPER_ADMIN],
  },
  [EscrowStatus.DISPUTED]: {
    [EscrowStatus.RELEASE_PENDING]: [ActorRole.ADMIN, ActorRole.SUPER_ADMIN, ActorRole.SUPPORT, ActorRole.SYSTEM],
    [EscrowStatus.REFUNDED]: [ActorRole.ADMIN, ActorRole.SUPER_ADMIN, ActorRole.SUPPORT, ActorRole.SYSTEM],
  },
  [EscrowStatus.RELEASED]: {},
  [EscrowStatus.REFUNDED]: {},
  [EscrowStatus.EXPIRED]: {},
  [EscrowStatus.CANCELLED]: {},
};

export function isTerminalState(status: EscrowStatus): boolean {
  return TERMINAL_STATES.has(status);
}

export function canTransition(from: EscrowStatus, to: EscrowStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  return Boolean(allowed && allowed[to]);
}

export function isAllowedActorForTransition(
  from: EscrowStatus,
  to: EscrowStatus,
  role: ActorRole
): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) return false;
  const roles = allowed[to];
  if (!roles) return false;
  return roles.includes(role);
}

export function validateTransition(params: StateTransitionParams): void {
  const { transactionId, previousState, newState, actorId, actorRole, timestamp, reason } = params;

  if (!transactionId || transactionId.trim() === "") {
    throw new InvalidTransitionPayloadError("Transaction ID is required");
  }

  if (!actorId || actorId.trim() === "") {
    throw new InvalidTransitionPayloadError("Actor ID is required");
  }

  if (!reason || reason.trim() === "") {
    throw new InvalidTransitionPayloadError("Transition reason is required");
  }

  if (!timestamp) {
    throw new InvalidTransitionPayloadError("Timestamp is required");
  }

  const dateVal = new Date(timestamp);
  if (isNaN(dateVal.getTime())) {
    throw new InvalidTransitionPayloadError("Invalid timestamp provided");
  }

  if (isTerminalState(previousState)) {
    throw new TerminalStateError(previousState);
  }

  if (!canTransition(previousState, newState)) {
    throw new InvalidStateTransitionError(previousState, newState);
  }

  if (!isAllowedActorForTransition(previousState, newState, actorRole)) {
    throw new UnauthorizedActorError(actorRole, previousState, newState);
  }
}

export function executeTransition(params: StateTransitionParams): EscrowStateTransition {
  validateTransition(params);

  const isoTimestamp = new Date(params.timestamp).toISOString();

  return {
    transactionId: params.transactionId,
    previousState: params.previousState,
    newState: params.newState,
    actorId: params.actorId,
    actorRole: params.actorRole,
    timestamp: isoTimestamp,
    reason: params.reason,
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

export function assertTransition(from: EscrowStatus, to: EscrowStatus): void {
  if (isTerminalState(from)) {
    throw new TerminalStateError(from);
  }
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}
