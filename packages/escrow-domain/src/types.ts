export enum EscrowStatus {
  DRAFT = "DRAFT",
  AWAITING_PAYMENT = "AWAITING_PAYMENT",
  FUNDS_HELD = "FUNDS_HELD",
  DISPUTED = "DISPUTED",
  RELEASED = "RELEASED",
  REFUNDED = "REFUNDED",
  CANCELLED = "CANCELLED",
}

export const VALID_TRANSITIONS: Record<EscrowStatus, EscrowStatus[]> = {
  [EscrowStatus.DRAFT]: [EscrowStatus.AWAITING_PAYMENT, EscrowStatus.CANCELLED],
  [EscrowStatus.AWAITING_PAYMENT]: [
    EscrowStatus.FUNDS_HELD,
    EscrowStatus.CANCELLED,
  ],
  [EscrowStatus.FUNDS_HELD]: [
    EscrowStatus.RELEASED,
    EscrowStatus.REFUNDED,
    EscrowStatus.DISPUTED,
  ],
  [EscrowStatus.DISPUTED]: [EscrowStatus.RELEASED, EscrowStatus.REFUNDED],
  [EscrowStatus.RELEASED]: [],
  [EscrowStatus.REFUNDED]: [],
  [EscrowStatus.CANCELLED]: [],
};

export interface EscrowTransaction {
  id: string;
  buyer_id: string;
  seller_id: string;
  arbitrator_id?: string | null;
  amount_cents: bigint;
  fee_cents: bigint;
  currency: string;
  status: EscrowStatus;
  description: string;
  terms: Record<string, any>;
  idempotency_key?: string | null;
  version: number;
  funded_at?: Date | null;
  closed_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}
