-- PostgreSQL 16 Schema Migration: 006_kushki_payments.sql

-- Enums for Payment Handling
CREATE TYPE payment_gateway AS ENUM ('KUSHKI');
CREATE TYPE payment_status AS ENUM ('INITIALIZED', 'PENDING_CHALLENGE', 'PROCESSING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'VOIDED');
CREATE TYPE payment_method_type AS ENUM ('CREDIT_CARD', 'DEBIT_CARD', 'TRANSFER');

-- Payment Transactions Table
CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id UUID NOT NULL REFERENCES escrow_transactions(id) ON DELETE CASCADE,
  gateway payment_gateway NOT NULL DEFAULT 'KUSHKI',
  method_type payment_method_type NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status payment_status NOT NULL DEFAULT 'INITIALIZED',
  kushki_ticket_number VARCHAR(255) UNIQUE,
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  requires_action BOOLEAN DEFAULT FALSE,
  action_url VARCHAR(1024),
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
