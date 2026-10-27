-- PostgreSQL 16 Schema Migration: 002_auth_hardening.sql
-- Escrow Ecuador Auth Hardening Schema Updates

-- Add Auth Hardening Columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS failed_login_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- Auth Refresh Tokens
CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id UUID,
  user_id UUID,
  token_hash VARCHAR(64),
  family_id UUID,
  is_revoked BOOLEAN,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_hash_revoked ON auth_refresh_tokens (token_hash, is_revoked);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_family_id ON auth_refresh_tokens (family_id);