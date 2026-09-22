-- PostgreSQL 16 Schema Migration: 002_release_refund_enhancements.sql
-- Add idempotency and failure diagnostic fields to releases and refunds

ALTER TABLE releases
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255) UNIQUE,
  ADD COLUMN IF NOT EXISTS failure_code VARCHAR(100),
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;

ALTER TABLE refunds
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255) UNIQUE,
  ADD COLUMN IF NOT EXISTS failure_code VARCHAR(100),
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;
