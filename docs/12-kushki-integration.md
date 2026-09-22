# 12 — Kushki Payment Integration & Adapter Specification

> **CRITICAL NOTICE**: Payment initiation/response does not constitute final confirmation of funds. Money is not moved or confirmed solely by initiating a payment or receiving a payment intent response from Kushki.

---

## Overview
This document specifies the payment integration layer for Kushki Ecuador. It establishes a provider-agnostic adapter design using the `PaymentProvider` interface, keeping the core Escrow domain isolated from third-party payment gateway implementations.

---

## Architecture & Provider Adapter Pattern

```text
[ Client / Frontend ]
        │
        ▼ (POST /api/v1/escrows/:id/payment)
[ PaymentRouter / PaymentService ]
        │
        ▼
┌─────────────────────────┐
│     PaymentProvider     │ (Abstract Interface)
└─────────────────────────┘
        │
        ├──► [ KushkiPaymentProvider ] ──► [ KushkiClient ] ──► (Kushki UAT/Sandbox API)
        │
        └──► [ MockPaymentProvider ]   ──► (In-Memory Mock for Local Tests)
```

The domain state machine and escrow services do not depend directly on Kushki SDKs or endpoints. All payment operations route through the `PaymentProvider` contract.

---

## Environment Variables

| Variable | Description | Default | Sandbox / UAT |
|---|---|---|---|
| `KUSHKI_PUBLIC_MERCHANT_ID` | Public merchant key (for frontend tokenization) | Optional in tests | Kushki UAT Public ID |
| `KUSHKI_PRIVATE_MERCHANT_ID` | Private merchant key (for backend charges) | `mock-private-merchant-id` | Kushki UAT Private ID |
| `KUSHKI_ENVIRONMENT` | Target Kushki environment (`sandbox` or `production`) | `sandbox` | `sandbox` |
| `KUSHKI_API_BASE_URL` | Base URL for Kushki REST endpoints | `https://api-uat.kushkipagosoficial.com` | `https://api-uat.kushkipagosoficial.com` |
| `USE_KUSHKI_PROVIDER` | Flag to enable real `KushkiPaymentProvider` | `false` | Set to `true` in integration UAT |

> **Security Warning**: Private keys (`KUSHKI_PRIVATE_MERCHANT_ID`) must never be exposed to frontend code, committed to source control, or logged in application logs.

---

## Payment Flow

1. **Escrow Creation**: Buyer/Seller creates an escrow transaction in `CREATED` or `AWAITING_PAYMENT` state.
2. **Payment Tokenization (Frontend)**: Frontend collects payment details using Kushki's official JavaScript SDK / Smart Checkout and receives a secure single-use payment token.
3. **Payment Initiation (Backend)**:
   - Frontend calls `POST /api/v1/escrows/:id/payment` with optional `{ token }` and mandatory `Idempotency-Key` header.
   - Backend derives amount and currency **strictly from the Escrow record in the database** (never trusting frontend amount overrides).
   - Backend formats amount with exact `NUMERIC(20,2)` precision.
   - `PaymentService` invokes `PaymentProvider.createPaymentIntent(...)`.
   - `KushkiPaymentProvider` calls Kushki API `/card/v1/charges` with private merchant credentials.
   - Backend stores a `Payment` record in state `PENDING` or `PROCESSING` and logs an audit log entry.
   - Backend returns `{ payment, checkoutData, disclaimer }` to frontend.
4. **Final Confirmation (Future Task 7)**: Funds confirmation and ledger posting will occur in Task 7 upon receiving verified Kushki webhook events or reconciliation.

---

## Security & Card Data Policy

- **No Card Data Storage**: The platform **never accepts, transmits, or stores** raw card numbers (PAN), CVV/CVC, expiration dates, or PINs.
- **Tokenization**: Card details are tokenized directly on client browsers via Kushki. The backend only handles single-use tokens.
- **Log Sanitization**: `KushkiMapper.sanitizeResponse()` strips sensitive fields (`pan`, `cvv`, `cardNumber`, `privateMerchantId`) prior to logging or returning API responses.
- **Header Injection Defense**: Private merchant credentials are appended securely server-side.

---

## Idempotency & Timeouts

- **Idempotency Keys**: `POST /api/v1/escrows/:id/payment` requires/supports `Idempotency-Key` headers.
- **Duplicate Prevention**: Repeating a request with the same idempotency key returns the original `Payment` record and checkout data without triggering a second charge on Kushki.
- **Payload Conflict**: Reusing the same key with a different payload produces HTTP `409 IDEMPOTENCY_CONFLICT`.
- **Client Timeouts**: `KushkiClient` uses an explicit 10-second timeout (`AbortController`). A network timeout returns a HTTP 504/502 error without making blind retries, protecting against double-charge scenarios.

---

## Scope Boundaries

### What Task 6 Implements:
- `PaymentProvider` interface & `KushkiPaymentProvider` adapter.
- `KushkiClient` with timeout handling & log sanitization.
- `KushkiMapper` for status normalization (`APPROVED`, `DECLINED`, `PENDING`, `FAILED`, `PROCESSING`).
- `MockPaymentProvider` for automated local testing.
- Endpoint `POST /api/v1/escrows/:id/payment` & `GET /api/v1/payments/:id`.
- DB `payments` record creation & audit logging.

### What Task 6 DOES NOT Do (Deferred to Later Tasks):
- **Task 7**: Webhook event processing (`POST /api/v1/webhooks/kushki`), webhook signature verification, event deduplication, reconciliation, and automated confirmation of funds.
- **Task 8**: Fiduciary integrations, automated release of funds, refund payout execution, or bank account cashouts.
