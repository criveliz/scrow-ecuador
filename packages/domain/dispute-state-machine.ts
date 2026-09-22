import { ActorRole } from "./state-machine.js";

export enum DisputeStatus {
  OPEN = "OPEN",
  UNDER_REVIEW = "UNDER_REVIEW",
  WAITING_BUYER = "WAITING_BUYER",
  WAITING_SELLER = "WAITING_SELLER",
  WAITING_EVIDENCE = "WAITING_EVIDENCE",
  ESCALATED = "ESCALATED",
  RESOLVED_BUYER = "RESOLVED_BUYER",
  RESOLVED_SELLER = "RESOLVED_SELLER",
  RESOLVED_SPLIT = "RESOLVED_SPLIT",
  CANCELLED = "CANCELLED",
  CLOSED = "CLOSED",
}

export enum DisputeReason {
  ITEM_NOT_RECEIVED = "ITEM_NOT_RECEIVED",
  ITEM_NOT_AS_DESCRIBED = "ITEM_NOT_AS_DESCRIBED",
  DAMAGED_ITEM = "DAMAGED_ITEM",
  WRONG_ITEM = "WRONG_ITEM",
  PAYMENT_PROBLEM = "PAYMENT_PROBLEM",
  DELIVERY_PROBLEM = "DELIVERY_PROBLEM",
  SELLER_NON_PERFORMANCE = "SELLER_NON_PERFORMANCE",
  BUYER_NON_PERFORMANCE = "BUYER_NON_PERFORMANCE",
  FRAUD_SUSPECTED = "FRAUD_SUSPECTED",
  OTHER = "OTHER",
}

export enum DisputeAction {
  OPEN = "OPEN",
  ASSIGN = "ASSIGN",
  REQUEST_BUYER_EVIDENCE = "REQUEST_BUYER_EVIDENCE",
  REQUEST_SELLER_EVIDENCE = "REQUEST_SELLER_EVIDENCE",
  REQUEST_ADDITIONAL_EVIDENCE = "REQUEST_ADDITIONAL_EVIDENCE",
  START_REVIEW = "START_REVIEW",
  ESCALATE = "ESCALATE",
  RESOLVE_BUYER = "RESOLVE_BUYER",
  RESOLVE_SELLER = "RESOLVE_SELLER",
  RESOLVE_SPLIT = "RESOLVE_SPLIT",
  CANCEL = "CANCEL",
  CLOSE = "CLOSE",
}

export const TERMINAL_DISPUTE_STATES: ReadonlySet<DisputeStatus> = new Set([
  DisputeStatus.RESOLVED_BUYER,
  DisputeStatus.RESOLVED_SELLER,
  DisputeStatus.RESOLVED_SPLIT,
  DisputeStatus.CANCELLED,
  DisputeStatus.CLOSED,
]);

export class InvalidDisputeStateTransitionError extends Error {
  constructor(
    public readonly previousState: DisputeStatus,
    public readonly newState: DisputeStatus,
    message?: string
  ) {
    super(message ?? `Invalid dispute state transition from ${previousState} to ${newState}`);
    this.name = "InvalidDisputeStateTransitionError";
  }
}

export class UnauthorizedDisputeActorError extends Error {
  constructor(
    public readonly actorRole: ActorRole | string,
    public readonly action: DisputeAction | string,
    message?: string
  ) {
    super(message ?? `Actor with role '${actorRole}' is not authorized to perform dispute action '${action}'`);
    this.name = "UnauthorizedDisputeActorError";
  }
}

export class TerminalDisputeStateError extends Error {
  constructor(public readonly currentState: DisputeStatus, message?: string) {
    super(message ?? `Cannot transition out of terminal dispute state: ${currentState}`);
    this.name = "TerminalDisputeStateError";
  }
}

export const ALLOWED_DISPUTE_TRANSITIONS: Record<
  DisputeStatus,
  Partial<Record<DisputeStatus, (ActorRole | string)[]>>
> = {
  [DisputeStatus.OPEN]: {
    [DisputeStatus.UNDER_REVIEW]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.WAITING_BUYER]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.WAITING_SELLER]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.WAITING_EVIDENCE]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.ESCALATED]: [ActorRole.BUYER, ActorRole.SELLER, ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_BUYER]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_SELLER]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_SPLIT]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.CANCELLED]: [ActorRole.BUYER, ActorRole.SELLER, ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
  },
  [DisputeStatus.UNDER_REVIEW]: {
    [DisputeStatus.WAITING_BUYER]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.WAITING_SELLER]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.WAITING_EVIDENCE]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.ESCALATED]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_BUYER]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_SELLER]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_SPLIT]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.CLOSED]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
  },
  [DisputeStatus.WAITING_BUYER]: {
    [DisputeStatus.UNDER_REVIEW]: [ActorRole.BUYER, ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.WAITING_EVIDENCE]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.ESCALATED]: [ActorRole.BUYER, ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_BUYER]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_SELLER]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_SPLIT]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
  },
  [DisputeStatus.WAITING_SELLER]: {
    [DisputeStatus.UNDER_REVIEW]: [ActorRole.SELLER, ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.WAITING_EVIDENCE]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.ESCALATED]: [ActorRole.SELLER, ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_BUYER]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_SELLER]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_SPLIT]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
  },
  [DisputeStatus.WAITING_EVIDENCE]: {
    [DisputeStatus.UNDER_REVIEW]: [ActorRole.BUYER, ActorRole.SELLER, ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.ESCALATED]: [ActorRole.BUYER, ActorRole.SELLER, ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_BUYER]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_SELLER]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_SPLIT]: [ActorRole.SUPPORT, ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
  },
  [DisputeStatus.ESCALATED]: {
    [DisputeStatus.UNDER_REVIEW]: [ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_BUYER]: [ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_SELLER]: [ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.RESOLVED_SPLIT]: [ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
    [DisputeStatus.CLOSED]: [ActorRole.ADMIN, ActorRole.SYSTEM, "SUPER_ADMIN"],
  },
  [DisputeStatus.RESOLVED_BUYER]: {},
  [DisputeStatus.RESOLVED_SELLER]: {},
  [DisputeStatus.RESOLVED_SPLIT]: {},
  [DisputeStatus.CANCELLED]: {},
  [DisputeStatus.CLOSED]: {},
};

export function isTerminalDisputeState(status: DisputeStatus): boolean {
  return TERMINAL_DISPUTE_STATES.has(status);
}

export function validateDisputeTransition(
  previousState: DisputeStatus,
  newState: DisputeStatus,
  actorRole: ActorRole | string,
  action: DisputeAction | string
): void {
  if (isTerminalDisputeState(previousState)) {
    throw new TerminalDisputeStateError(previousState);
  }

  // Check resolution authorization: BUYER and SELLER are strictly prohibited from resolving dispute!
  if (
    newState === DisputeStatus.RESOLVED_BUYER ||
    newState === DisputeStatus.RESOLVED_SELLER ||
    newState === DisputeStatus.RESOLVED_SPLIT ||
    action === DisputeAction.RESOLVE_BUYER ||
    action === DisputeAction.RESOLVE_SELLER ||
    action === DisputeAction.RESOLVE_SPLIT
  ) {
    if (actorRole === ActorRole.BUYER || actorRole === ActorRole.SELLER) {
      throw new UnauthorizedDisputeActorError(
        actorRole,
        action,
        `Participants (${actorRole}) cannot resolve disputes; operational review is required.`
      );
    }
  }

  const allowed = ALLOWED_DISPUTE_TRANSITIONS[previousState];
  if (!allowed || !allowed[newState]) {
    throw new InvalidDisputeStateTransitionError(previousState, newState);
  }

  const allowedRoles = allowed[newState]!;
  if (!allowedRoles.includes(actorRole)) {
    throw new UnauthorizedDisputeActorError(actorRole, action);
  }
}
