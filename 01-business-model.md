# 01 — Business Model

## Product
Digital escrow transaction orchestration for small online transactions in Ecuador.

## Participants
- Buyer
- Seller
- Platform operator
- Authorized payment provider
- Authorized fiduciary/banking provider
- Support/admin team

## Core proposition
The platform coordinates payment, transaction conditions, evidence, notifications, dispute handling, and release/refund instructions. The custody of funds must be handled according to the final legal structure and provider agreements.

## Revenue model
Potential revenue:
- transaction commission
- optional premium verification/services
- business/API plans

The final pricing model must be configured, not hard-coded.

## MVP
Start with web transactions and payment links. Do not make Facebook Marketplace or WhatsApp the system of record.

## Key business rules
- Every transaction has a unique reference.
- Buyer and seller must be identified according to the final KYC policy.
- Money amounts are stored as exact decimal values.
- Provider events are reconciled against internal records.
- A dispute pauses automatic release.
- Release/refund requires an authorized business action.
- Every privileged action creates an audit event.

## Non-goals for MVP
- Native mobile apps
- Deep Facebook integration
- Multiple fiduciaries at once
- AI fraud scoring
- Automated notarial workflows
- Microservice decomposition
