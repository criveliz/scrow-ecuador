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

const transitions: Record<EscrowStatus, EscrowStatus[]> = {
  [EscrowStatus.CREATED]: [EscrowStatus.AWAITING_PAYMENT, EscrowStatus.CANCELLED],
  [EscrowStatus.AWAITING_PAYMENT]: [
    EscrowStatus.PAYMENT_RECEIVED,
    EscrowStatus.EXPIRED,
    EscrowStatus.CANCELLED,
  ],
  [EscrowStatus.PAYMENT_RECEIVED]: [
    EscrowStatus.FUNDS_CONFIRMED,
    EscrowStatus.DISPUTED,
  ],
  [EscrowStatus.FUNDS_CONFIRMED]: [
    EscrowStatus.SELLER_ACCEPTED,
    EscrowStatus.DISPUTED,
  ],
  [EscrowStatus.SELLER_ACCEPTED]: [
    EscrowStatus.DELIVERY_PENDING,
    EscrowStatus.DISPUTED,
  ],
  [EscrowStatus.DELIVERY_PENDING]: [
    EscrowStatus.DELIVERED,
    EscrowStatus.DISPUTED,
  ],
  [EscrowStatus.DELIVERED]: [
    EscrowStatus.BUYER_CONFIRMED,
    EscrowStatus.DISPUTED,
  ],
  [EscrowStatus.BUYER_CONFIRMED]: [EscrowStatus.RELEASE_PENDING],
  [EscrowStatus.RELEASE_PENDING]: [EscrowStatus.RELEASED, EscrowStatus.DISPUTED],
  [EscrowStatus.RELEASED]: [],
  [EscrowStatus.DISPUTED]: [
    EscrowStatus.REFUNDED,
    EscrowStatus.RELEASE_PENDING,
  ],
  [EscrowStatus.REFUNDED]: [],
  [EscrowStatus.EXPIRED]: [],
  [EscrowStatus.CANCELLED]: [],
};

export function canTransition(from: EscrowStatus, to: EscrowStatus): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(from: EscrowStatus, to: EscrowStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid escrow transition: ${from} -> ${to}`);
  }
}
