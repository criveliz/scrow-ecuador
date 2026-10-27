-- Enums
DO $$ BEGIN CREATE TYPE escrow_status AS ENUM ( 'DRAFT', 'AWAITING_PAYMENT', 'FUNDS_HELD', 'DISPUTED', 'RELEASED', 'REFUNDED', 'CANCELLED' ); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Table: escrow_transactions
CREATE TABLE IF NOT EXISTS escrow_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    arbitrator_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    status escrow_status NOT NULL DEFAULT 'DRAFT',
    description TEXT NOT NULL,
    terms JSONB NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key VARCHAR(64) UNIQUE,
    version INT NOT NULL DEFAULT 1,
    funded_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT check_distinct_counterparties CHECK (buyer_id <> seller_id)
);

CREATE INDEX IF NOT EXISTS idx_escrow_buyer_status ON escrow_transactions(buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_escrow_seller_status ON escrow_transactions(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_escrow_idempotency ON escrow_transactions(idempotency_key);

-- Table: escrow_audit_ledger (Append-only state machine ledger)
CREATE TABLE IF NOT EXISTS escrow_audit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escrow_id UUID NOT NULL REFERENCES escrow_transactions(id) ON DELETE RESTRICT,
    from_status escrow_status NOT NULL,
    to_status escrow_status NOT NULL,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(50) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escrow_ledger_tx ON escrow_audit_ledger(escrow_id, created_at);
