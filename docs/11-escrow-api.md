# 11 — Escrow API Specification

## Overview
The Escrow API provides secure, authenticated REST endpoints for managing escrow transactions in Ecuador. It enforces double-entry ledger integration, strict RBAC, IDOR protection, exact monetary precision (`NUMERIC(20,2)`), idempotency on mutations, domain state machine transitions, and full audit logging.

---

## Authentication & Authorization
All escrow endpoints require a valid JWT bearer token in the `Authorization` header:
```http
Authorization: Bearer <access_token>
```

### Roles Supported
- `BUYER`: Can create escrows (as buyer), view owned escrows, execute buyer transitions (`CANCEL_ESCROW`, `BUYER_CONFIRM`, `REQUEST_RELEASE`, `OPEN_DISPUTE`).
- `SELLER`: Can create escrows (as seller), view owned escrows, execute seller transitions (`ACCEPT_ESCROW`, `MARK_DELIVERY_PENDING`, `MARK_DELIVERED`, `CANCEL_ESCROW`, `OPEN_DISPUTE`).
- `ADMIN` / `SUPPORT`: Can view all escrows, resolve disputes, execute administrative transitions (`REQUEST_REFUND`, `REQUEST_RELEASE`).

---

## Endpoints Summary

| Method | Path | Description | Allowed Roles |
|---|---|---|---|
| `POST` | `/api/v1/escrows` | Create a new escrow operation | `BUYER`, `SELLER` |
| `GET` | `/api/v1/escrows` | List escrows for authenticated user | `BUYER`, `SELLER`, `ADMIN`, `SUPPORT` |
| `GET` | `/api/v1/escrows/:id` | Get specific escrow details | `BUYER`, `SELLER` (owners), `ADMIN`, `SUPPORT` |
| `POST` | `/api/v1/escrows/:id/actions` | Execute business state transition | `BUYER`, `SELLER` (owners), `ADMIN`, `SUPPORT` |
| `GET` | `/api/v1/escrows/:id/history` | Get audit log history of escrow | `BUYER`, `SELLER` (owners), `ADMIN`, `SUPPORT` |

> **Note**: Direct status modification (e.g. `PATCH /api/v1/escrows/:id/status`) is **strictly forbidden**. All state transitions must pass through business actions via `POST /api/v1/escrows/:id/actions`.

---

## Endpoint Details

### 1. Create Escrow
`POST /api/v1/escrows`

#### Headers
- `Authorization: Bearer <token>`
- `Content-Type: application/json`
- `Idempotency-Key: <unique-key>` (Optional but recommended)

#### Request Body
```json
{
  "seller_id": "3a09e07d-08b5-4b13-a417-66dd6622bc1d",
  "amount": "150.50",
  "currency": "USD",
  "description": "Purchase of laptop",
  "expires_at": "2026-10-01T00:00:00.000Z"
}
```

#### Response (`201 Created`)
```json
{
  "escrow": {
    "id": "e8b11111-2222-3333-4444-555555555555",
    "external_reference": "ESC-1758521000-a1b2c3d4",
    "buyer_id": "11111111-1111-1111-1111-111111111111",
    "seller_id": "3a09e07d-08b5-4b13-a417-66dd6622bc1d",
    "amount": "150.50",
    "currency": "USD",
    "status": "CREATED",
    "description": "Purchase of laptop",
    "expires_at": "2026-10-01T00:00:00.000Z",
    "created_at": "2026-09-22T05:50:00.000Z",
    "updated_at": "2026-09-22T05:50:00.000Z"
  }
}
```

---

### 2. List Escrows
`GET /api/v1/escrows?page=1&limit=10`

#### Query Parameters
- `page` (default `1`): Page number.
- `limit` (default `10`, max `100`): Results per page.

#### Response (`200 OK`)
```json
{
  "escrows": [ ... ],
  "total": 1,
  "page": 1,
  "limit": 10
}
```

---

### 3. Get Escrow
`GET /api/v1/escrows/:id`

#### Response (`200 OK`)
```json
{
  "escrow": {
    "id": "e8b11111-2222-3333-4444-555555555555",
    "status": "CREATED",
    "amount": "150.50",
    ...
  }
}
```

---

### 4. Execute Action
`POST /api/v1/escrows/:id/actions`

#### Supported Action Names
- `PROCEED_TO_PAYMENT` / `START_PAYMENT` -> `AWAITING_PAYMENT`
- `ACCEPT_ESCROW` / `SELLER_ACCEPT` -> `SELLER_ACCEPTED`
- `MARK_DELIVERY_PENDING` -> `DELIVERY_PENDING`
- `MARK_DELIVERED` -> `DELIVERED`
- `BUYER_CONFIRM` -> `BUYER_CONFIRMED`
- `REQUEST_RELEASE` -> `RELEASE_PENDING`
- `OPEN_DISPUTE` -> `DISPUTED`
- `CANCEL_ESCROW` / `CANCEL` -> `CANCELLED`
- `REQUEST_REFUND` -> `REFUNDED` (Admin/Support)

#### Request Body
```json
{
  "action": "CANCEL_ESCROW",
  "reason": "Decided not to proceed"
}
```

#### Response (`200 OK`)
```json
{
  "escrow": {
    "id": "e8b11111-2222-3333-4444-555555555555",
    "status": "CANCELLED",
    "updated_at": "2026-09-22T05:51:00.000Z"
  }
}
```

---

### 5. Get Audit History
`GET /api/v1/escrows/:id/history`

#### Response (`200 OK`)
```json
{
  "history": [
    {
      "id": "a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5",
      "actor_id": "11111111-1111-1111-1111-111111111111",
      "action": "CREATE_ESCROW",
      "entity_type": "escrow",
      "entity_id": "e8b11111-2222-3333-4444-555555555555",
      "previous_state": null,
      "new_state": "CREATED",
      "created_at": "2026-09-22T05:50:00.000Z"
    }
  ]
}
```

---

## Security & Error Responses

| HTTP Code | Error Code | Description |
|---|---|---|
| `400` | `BAD_REQUEST` | Validation error (e.g. invalid amount, missing action, invalid JSON) |
| `401` | `UNAUTHORIZED` | Missing, invalid, or expired JWT token |
| `403` | `FORBIDDEN` | IDOR access denied or unauthorized role for transition |
| `404` | `NOT_FOUND` | Escrow or target user not found |
| `409` | `INVALID_STATE_TRANSITION` | Transition not allowed by state machine for current state |
| `409` | `IDEMPOTENCY_CONFLICT` | Idempotency key reused with different request payload |
| `500` | `INTERNAL_SERVER_ERROR` | Unexpected error (stack trace concealed) |

---

## Financial Integrity & Money Movement Notice
Task 5 implements the REST API core layer. It **does not process real payments or trigger monetary movement**. State `AWAITING_PAYMENT` is supported in domain, but real money movement is handled via mock or integration adapters in future tasks.
