-- PostgreSQL 16 Schema Migration: 002_verifications.sql
-- Verification & Identity Audit Schema for CipherByte/CipherID

CREATE TABLE IF NOT EXISTS verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id UUID REFERENCES escrow_transactions(id) ON DELETE CASCADE,
  party_id UUID REFERENCES users(id) ON DELETE SET NULL,
  provider VARCHAR(100) NOT NULL,
  verification_type VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  provider_reference VARCHAR(255),
  request_hash CHAR(64),
  response_hash CHAR(64),
  verified_at TIMESTAMPTZ,
  cost_tokens NUMERIC(10,2) DEFAULT 0.00,
  raw_response_location TEXT,
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_verifications_escrow_id ON verifications(escrow_id);
CREATE INDEX IF NOT EXISTS idx_verifications_party_id ON verifications(party_id);
CREATE INDEX IF NOT EXISTS idx_verifications_provider_ref ON verifications(provider_reference);
