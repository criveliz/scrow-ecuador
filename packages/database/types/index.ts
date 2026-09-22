import { ActorRole, EscrowStatus } from "@escrow-ecuador/domain";

export interface User {
  id: string;
  email: string;
  phone?: string | null;
  password_hash: string;
  role: ActorRole | string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface Identity {
  id: string;
  user_id: string;
  provider: string;
  provider_reference: string;
  verification_status: string;
  verified_at?: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface EscrowTransaction {
  id: string;
  external_reference: string;
  buyer_id: string;
  seller_id: string;
  amount: string; // Stored as NUMERIC(20,2) string to preserve exact financial precision
  currency: string;
  status: EscrowStatus;
  description?: string | null;
  expires_at?: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface Payment {
  id: string;
  escrow_id: string;
  provider: string;
  provider_payment_id?: string | null;
  amount: string;
  currency: string;
  status: string;
  provider_reference?: string | null;
  received_at?: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface Release {
  id: string;
  escrow_id: string;
  amount: string;
  currency: string;
  status: string;
  provider: string;
  provider_release_id?: string | null;
  requested_at?: Date | string;
  completed_at?: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface Refund {
  id: string;
  escrow_id: string;
  amount: string;
  currency: string;
  status: string;
  provider: string;
  provider_refund_id?: string | null;
  requested_at?: Date | string;
  completed_at?: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface Dispute {
  id: string;
  escrow_id: string;
  opened_by: string;
  reason: string;
  description?: string | null;
  status?: string;
  resolved_by?: string | null;
  resolution?: string | null;
  opened_at?: Date | string;
  resolved_at?: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface Evidence {
  id: string;
  escrow_id: string;
  uploaded_by: string;
  type: string;
  storage_reference: string;
  sha256?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: Date | string;
}

export interface Notification {
  id: string;
  user_id: string;
  escrow_id?: string | null;
  channel: string;
  type: string;
  status: string;
  provider_reference?: string | null;
  sent_at?: Date | string | null;
  created_at: Date | string;
}

export interface WebhookEvent {
  id: string;
  provider: string;
  event_id: string;
  event_type: string;
  payload_hash?: string | null;
  payload: Record<string, unknown>;
  signature_verified: boolean;
  status?: string;
  received_at?: Date | string;
  processed_at?: Date | string | null;
  error_message?: string | null;
}

export interface AuditLog {
  id: string;
  actor_id?: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  previous_state?: string | null;
  new_state?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: Date | string;
}

export interface RefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string;
  revoked: boolean;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface IdempotencyKeyRecord {
  id: string;
  key: string;
  scope: string;
  request_hash?: string | null;
  response_status?: number | null;
  response_body?: Record<string, unknown> | null;
  created_at: Date | string;
  expires_at: Date | string;
}

export enum LedgerAccountType {
  ASSET = "ASSET",
  LIABILITY = "LIABILITY",
  EQUITY = "EQUITY",
  REVENUE = "REVENUE",
  EXPENSE = "EXPENSE",
}

export interface LedgerAccount {
  id: string;
  name: string;
  code: string;
  type: LedgerAccountType;
  description?: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface LedgerTransaction {
  id: string;
  escrow_id?: string | null;
  type: string;
  reference: string;
  status?: string;
  created_at: Date | string;
}

export enum LedgerDirection {
  DEBIT = "DEBIT",
  CREDIT = "CREDIT",
}

export interface LedgerEntry {
  id: string;
  ledger_transaction_id: string;
  ledger_account_id: string;
  direction: LedgerDirection;
  amount: string;
  currency: string;
  created_at: Date | string;
}
