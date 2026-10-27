# 06 — Initial REST API Contract

## Auth

POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh

## User

GET /api/v1/users/me

## Escrow

POST /api/v1/escrows
GET /api/v1/escrows/:id
GET /api/v1/escrows/:id/timeline
POST /api/v1/escrows/:id/accept-seller
POST /api/v1/escrows/:id/delivery
POST /api/v1/escrows/:id/confirm-buyer
POST /api/v1/escrows/:id/dispute
POST /api/v1/escrows/:id/request-release
POST /api/v1/escrows/:id/request-refund

## Webhooks

POST /api/v1/webhooks/kushki
POST /api/v1/webhooks/fiduciary

## Admin

GET /api/v1/admin/escrows
GET /api/v1/admin/disputes
GET /api/v1/admin/audit

## API principles

- JSON
- versioned under /api/v1
- request IDs
- idempotency keys for financial mutations
- structured errors
- pagination
- authorization on every protected route
