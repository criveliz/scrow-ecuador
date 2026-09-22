export declare enum EscrowStatus {
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
    CANCELLED = "CANCELLED"
}
export declare enum ActorRole {
    BUYER = "BUYER",
    SELLER = "SELLER",
    SUPPORT = "SUPPORT",
    ADMIN = "ADMIN",
    SYSTEM = "SYSTEM"
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
export declare class InvalidStateTransitionError extends Error {
    readonly previousState: EscrowStatus;
    readonly newState: EscrowStatus;
    constructor(previousState: EscrowStatus, newState: EscrowStatus, message?: string);
}
export declare class UnauthorizedActorError extends Error {
    readonly actorRole: ActorRole;
    readonly previousState: EscrowStatus;
    readonly newState: EscrowStatus;
    constructor(actorRole: ActorRole, previousState: EscrowStatus, newState: EscrowStatus, message?: string);
}
export declare class TerminalStateError extends Error {
    readonly currentState: EscrowStatus;
    constructor(currentState: EscrowStatus, message?: string);
}
export declare class InvalidTransitionPayloadError extends Error {
    constructor(message: string);
}
export declare const TERMINAL_STATES: ReadonlySet<EscrowStatus>;
export declare const ALLOWED_TRANSITIONS: Record<EscrowStatus, Partial<Record<EscrowStatus, ActorRole[]>>>;
export declare function isTerminalState(status: EscrowStatus): boolean;
export declare function canTransition(from: EscrowStatus, to: EscrowStatus): boolean;
export declare function isAllowedActorForTransition(from: EscrowStatus, to: EscrowStatus, role: ActorRole): boolean;
export declare function validateTransition(params: StateTransitionParams): void;
export declare function executeTransition(params: StateTransitionParams): EscrowStateTransition;
export declare function assertTransition(from: EscrowStatus, to: EscrowStatus): void;
//# sourceMappingURL=state-machine.d.ts.map