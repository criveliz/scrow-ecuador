# 13 — Kushki Webhooks & Financial Reconciliation

## Overview
This document specifies the design, security layer, idempotency mechanisms, event deduplication, and financial reconciliation for Kushki webhooks in Escrow Ecuador.

## 1. Webhook Endpoint
- **URL Path**: `POST /api/v1/webhooks/kushki`
- **Authentication**: Public endpoint (no user JWT required). Security is enforced exclusively via Kushki HMAC SHA-256 signature verification and timestamp tolerance window.

## 2. Webhook Signature & Replay Verification (`KushkiWebhookVerifier`)
- **HMAC-SHA256 Verification**: Verifies incoming `x-kushki-signature` / `kushki-signature` headers against the raw request body and `x-kushki-timestamp` header using the configured webhook secret (`KUSHKI_WEBHOOK_SECRET`).
- **Replay Protection**: Rejects webhooks with timestamps outside the configurable tolerance window (default 300s / 5 minutes).
- **UAT & Production Configuration Note**:
  `UAT real pendiente por falta de credenciales activas.`
  In UAT or production environments, set `KUSHKI_WEBHOOK_SECRET` in environment variables.

## 3. Idempotency & Event Deduplication
- **Database Table**: `webhook_events`
- **Unique Constraint**: `CONSTRAINT uk_webhook_provider_event UNIQUE (provider, event_id)`
- **Atomic Insertion**: Uses database unique constraints to prevent race conditions when simultaneous duplicate webhooks arrive.
- **Handling Duplicates**: Duplicate webhooks return `200 OK` with `{ status: "ACCEPTED", isDuplicate: true, reconciliationStatus: "DUPLICATE" }` without re-processing payment or escrow states.

## 4. Status Mapping (`KushkiMapper`)
Maps external Kushki transaction statuses to internal `PaymentStatus`:
- `APPROVAL`, `APPROVED`, `SETTLED`, `SUCCESS`, `SUCCESSFUL` → `APPROVED`
- `PROCESSING`, `INITIALIZED`, `PENDING`, `IN_PROGRESS` → `PROCESSING`
- `DECLINED`, `REJECTED`, `CARD_DECLINED` → `DECLINED`
- `FAILED`, `ERROR`, `CANCELLED`, `VOIDED` → `FAILED`
- Any unrecognized external status → `UNKNOWN`

## 5. Out-of-Order Events
- Incoming event ranks are compared against the current internal payment status rank.
- Late or obsolete events (e.g., `PROCESSING` received after payment is already `APPROVED`) are safely logged and marked as `OUT_OF_ORDER` without regressing the payment or escrow state.

## 6. Financial Reconciliation (`ReconciliationService`)
Compares incoming Kushki provider data against internal payment and escrow records:
- **Transaction Matching**: Matched via `provider` + `provider_transaction_id` or `escrow_id`. Unmatched events are stored as `UNMATCHED`.
- **Exact Numeric Precision**: All comparisons use exact `NUMERIC(20,2)` decimal string format (e.g., `"100.00"`). Floating point comparisons are strictly forbidden.
- **Currency Verification**: Must match exact ISO currency string (`"USD"`).
- **Mismatch Handling**: If expected vs. provider amounts or currencies differ, payment status is set to `RECONCILIATION_MISMATCH`. Escrow status is NOT updated to `FUNDS_CONFIRMED`. An audit log is recorded for administrative review.

## 7. Payment Status vs. Escrow State Machine
- Webhook processing updates the **Payment** record first.
- If and only if reconciliation succeeds and payment is `APPROVED`, the **Escrow Transaction** is transitioned strictly using the domain state machine via `@escrow-ecuador/domain` `executeTransition()`.
- Allowed Escrow Progression: `CREATED` → `AWAITING_PAYMENT` → `PAYMENT_RECEIVED` → `FUNDS_CONFIRMED`.

## 8. Critical Directives
- **Webhook approval does not trigger fund release.**
- Webhooks confirm payment reception and update escrow status up to `FUNDS_CONFIRMED`.
- Fiduciary adapter payouts, bank transfers, releases, and refunds are explicitly reserved for Task 8.

## 9. Payload Sanitization & Audit Logging
- Raw payloads are sanitized before database insertion or logging. Sensitive fields (`pan`, `card_number`, `cvv`, `pin`, `password`, `secret`, `token`, `authorization`) are replaced with `"[REDACTED]"`.
- Audit logs are recorded for: `WEBHOOK_DUPLICATE_RECEIVED`, `WEBHOOK_UNKNOWN_EVENT`, `WEBHOOK_PAYMENT_UNMATCHED`, `PAYMENT_RECONCILIATION_MISMATCH`, `WEBHOOK_OUT_OF_ORDER_IGNORED`, `PAYMENT_STATUS_UPDATED`, and `ESCROW_FUNDS_CONFIRMED_VIA_WEBHOOK`.
