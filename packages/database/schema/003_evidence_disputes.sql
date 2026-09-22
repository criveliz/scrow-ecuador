-- PostgreSQL 16 Schema Migration: 003_evidence_disputes.sql
-- Escrow Ecuador Evidence & Disputes Architecture

-- 1. Extend evidence table
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream';
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS file_size BIGINT NOT NULL DEFAULT 0;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS original_filename VARCHAR(255);
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS visibility VARCHAR(50) NOT NULL DEFAULT 'PARTICIPANTS';
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS replaced_by_id UUID REFERENCES evidence(id);
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- 2. Evidence access audit log
CREATE TABLE IF NOT EXISTS evidence_access_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Extend disputes table
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id);
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS resolution_reason TEXT;

-- 4. Dispute state transition / action event history (Append-only)
CREATE TABLE IF NOT EXISTS dispute_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  previous_status VARCHAR(50),
  new_status VARCHAR(50) NOT NULL,
  actor_id UUID REFERENCES users(id),
  actor_role VARCHAR(50) NOT NULL,
  action VARCHAR(100) NOT NULL,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Link table for dispute evidence
CREATE TABLE IF NOT EXISTS dispute_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES users(id),
  submitted_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_dispute_evidence UNIQUE (dispute_id, evidence_id)
);

-- 6. Dispute assignment history
CREATE TABLE IF NOT EXISTS dispute_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  assigned_to UUID NOT NULL REFERENCES users(id),
  assigned_by UUID NOT NULL REFERENCES users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. Dispute deadlines
CREATE TABLE IF NOT EXISTS dispute_deadlines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  deadline_type VARCHAR(100) NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expired_at TIMESTAMPTZ
);
