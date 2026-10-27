# 07 — Data Model

Core tables:

users
identities
kyc_verifications
escrow_transactions
payments
releases
refunds
disputes
evidence
ledger_accounts
ledger_entries
ledger_transactions
webhook_events
audit_logs
notifications

Money:

- use NUMERIC(20,2) for USD amounts in PostgreSQL
- never use JavaScript floating-point arithmetic for financial calculations

Every financial table should include created_at and updated_at where appropriate.
