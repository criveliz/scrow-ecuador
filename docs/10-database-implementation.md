# 10 — Database Implementation

## Architecture & Technology
- **Database**: PostgreSQL 16
- **Monetary Representation**: `NUMERIC(20,2)` (no float / double precision).
- **Time Representation**: `TIMESTAMPTZ` stored internally in UTC.
- **Primary Keys**: UUID (v4) generated via `pgcrypto` or application layer.

## Schema & Tables
- `users`: User profiles, role-based access controls, password hashes.
- `identities`: User KYC provider references and verification statuses.
- `escrow_transactions`: Core escrow records mapped strictly to domain `EscrowStatus`.
- `payments`: Provider payment records with exact monetary amounts.
- `releases`: Release records preventing duplicate releases per escrow.
- `refunds`: Refund records for buyer returns or dispute resolutions.
- `disputes`: Dispute cases linked to escrow transactions.
- `evidence`: File storage references and SHA-256 hashes.
- `notifications`: Notification delivery log.
- `webhook_events`: Idempotent provider webhook event log with UNIQUE `(provider, event_id)`.
- `audit_logs`: Append-only system audit trail.
- `idempotency_keys`: Unique key/scope storage for idempotency enforcement.
- `ledger_accounts`: Chart of double-entry accounts (`CUSTOMER_FUNDS`, `PLATFORM_FEES`, `PENDING_RELEASE`, `REFUNDS`, `OTHER_CLEARING_ACCOUNTS`).
- `ledger_transactions`: Grouping headers for ledger postings.
- `ledger_entries`: Double-entry lines with strict balance constraint (`sum(debits) == sum(credits)`).

## Repository Layer & Domain State Integration
- State transitions in `EscrowRepository` invoke `@escrow-ecuador/domain` state machine validation (`executeTransition`).
- Double-entry transactions in `LedgerRepository` enforce debit/credit equality before posting.
- Webhook events enforce unique provider event ID persistence.

## Migrations & Local Development
- SQL Migrations: `packages/database/schema/001_initial.sql`.
- Migration Runner: `packages/database/migrations/migrate.ts`.
- Docker Compose: PostgreSQL 16 on port 5432, Redis 7 on port 6379.
