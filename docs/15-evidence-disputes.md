# Escrow Ecuador — Evidence & Disputes Architecture Documentation

## 1. Executive Summary

Task 9 implements the complete, production-oriented Evidence & Disputes subsystem for Escrow Ecuador. This architecture provides tamper-proof evidence handling, strong object integrity verification, an immutable dispute lifecycle state machine, configurable dispute deadlines, role-based access control (RBAC), anti-IDOR protections, notification event hooks, and a strict financial freeze mechanism.

**Critical Financial Control Notice:**
"Dispute resolution does not directly mutate financial balances. All financial effects must pass through the existing ReleaseService/RefundService and ledger controls."

"No real money movement is enabled by Task 9."

---

## 2. Evidence Domain Architecture

### 2.1 Evidence Fields & Entity Model
Each evidence item represents a physical or digital record associated with an escrow transaction.

- **`id`**: UUID primary key.
- **`escrow_id`**: Foreign key to `escrow_transactions(id)`.
- **`uploaded_by`**: Foreign key to `users(id)`.
- **`type`**: Extensible evidence classification (`PAYMENT_PROOF`, `DELIVERY_PROOF`, `PRODUCT_PHOTO`, `PRODUCT_VIDEO`, `SHIPPING_DOCUMENT`, `TRACKING_NUMBER`, `IDENTITY_DOCUMENT`, `COMMUNICATION`, `CONTRACT`, `RECEIPT`, `OTHER`).
- **`description`**: Sanitized text description.
- **`storage_reference`**: Key pointing to stored object within namespace `escrows/${escrowId}/${uuid}-${filename}`.
- **`sha256`**: SHA-256 hexadecimal hash computed directly from stored object content.
- **`mime_type`**: Validated MIME type (e.g. `application/pdf`, `image/jpeg`, `image/png`, `video/mp4`).
- **`file_size`**: Exact size in bytes.
- **`original_filename`**: Sanitized original filename.
- **`captured_at`**: Optional capture timestamp.
- **`status`**: Current record status (`ACTIVE`, `VERIFIED`, `REPLACED`, `REJECTED`, `INTEGRITY_FAILED`).
- **`visibility`**: Access classification (`PRIVATE`, `PARTICIPANTS`, `SUPPORT`, `ADMIN`, `DISPUTE_REVIEW`).
- **`replaced_by_id`**: Pointer to replacement evidence record for append-only audit tracking.
- **`ip_address` / `user_agent`**: Request context captured at upload time.
- **`metadata`**: Sanitized JSON object containing upload parameters.

### 2.2 Evidence Storage Abstraction
The system abstracts object storage behind the `EvidenceStorageProvider` interface:

- `createUploadIntent(input)`: Generates a presigned upload URL and storage key.
- `putObject(input)`: Stores binary content and computes actual SHA-256 hash.
- `getObject(key)`: Retrieves binary content and MIME type.
- `getDownloadUrl(key, expiresInSeconds)`: Generates time-bound, authorized download URL.
- `deleteObject(key)` / `exists(key)`: Management operations.
- `calculateHash(content)`: SHA-256 computation using Node `crypto`.

**Production Storage Safety Guard:**
Production mode (`NODE_ENV === "production"`) enforces that `MockEvidenceStorageProvider` cannot silently run. Missing cloud storage configuration (e.g. `AWS_S3_BUCKET`, `AWS_REGION`) fails closed immediately.

---

## 3. Evidence Security & Integrity Model

### 3.1 Content Verification & Anti-Spoofing
1. **Server-Side SHA-256 Calculation**: The SHA-256 hash is computed from the actual byte array stored in the object provider. Client-provided hashes are never trusted blindly.
2. **Integrity Verification Method**: `verifyIntegrity(evidenceId)` fetches stored content, re-computes SHA-256, and compares it against the database record. If a mismatch is detected, status transitions to `INTEGRITY_FAILED` and an audit event (`EVIDENCE_INTEGRITY_FAILURE`) is recorded.
3. **MIME Type Validation**: Only explicit safe MIME types are allowed (`ALLOWED_MIME_TYPES`). Executable MIME types (`application/x-executable`, `application/x-sh`, `text/html`, etc.) are rejected.
4. **File Size Limits**: Enforced maximum limit of 25MB (`25 * 1024 * 1024` bytes).
5. **Path Traversal & Dangerous Extensions**: Filenames are sanitized to remove path traversal sequences (`..`, `/`, `\`, null bytes). Dangerous extensions (`.exe`, `.sh`, `.bat`, `.cmd`, `.js`, `.php`, `.py`) are rejected.
6. **Card Data Protection**: Descriptions and metadata are scanned for sensitive payment card patterns (13-19 digit card numbers). Matches throw `SensitiveDataDetectedError` to prevent credential leakage.

### 3.2 Visibility & IDOR Prevention
Access to evidence is authorized by `checkAccessPermission`:
- **Unrelated Users**: Strictly denied access (IDOR protection).
- **Escrow Participants (Buyer & Seller)**: Can access evidence marked `PARTICIPANTS` or `DISPUTE_REVIEW`. `PRIVATE` evidence is accessible only by the creator.
- **Operational Staff (Support, Admin, Super Admin, System)**: Authorized to access evidence for audit and dispute resolution.
- **Access Audit Trail**: Every evidence view or download request records an entry in `evidence_access_events`.

---

## 4. Dispute Subsystem Lifecycle & State Machine

### 4.1 Dispute States
- **`OPEN`**: Dispute initialized by participant or support.
- **`UNDER_REVIEW`**: Assigned support/admin reviewing evidence and claim.
- **`WAITING_BUYER`**: Waiting for buyer response or evidence submission.
- **`WAITING_SELLER`**: Waiting for seller response or evidence submission.
- **`WAITING_EVIDENCE`**: Waiting for additional documentation.
- **`ESCALATED`**: Escalated to senior administrative review.
- **`RESOLVED_BUYER`**: Resolved in favor of buyer (Terminal state).
- **`RESOLVED_SELLER`**: Resolved in favor of seller (Terminal state).
- **`RESOLVED_SPLIT`**: Resolved via split agreement (Terminal state).
- **`CANCELLED`**: Cancelled by opener (Terminal state).
- **`CLOSED`**: Closed operationally (Terminal state).

### 4.2 State Machine & RBAC Authorization
- State transitions are strictly validated against `ALLOWED_DISPUTE_TRANSITIONS`.
- **RBAC Rule**: `BUYER` and `SELLER` roles are **strictly prohibited** from performing resolution actions (`RESOLVE_BUYER`, `RESOLVE_SELLER`, `RESOLVE_SPLIT`). Dispute resolution requires operational roles (`SUPPORT`, `ADMIN`, `SUPER_ADMIN`, `SYSTEM`).
- Transitions out of terminal states are blocked (`TerminalDisputeStateError`).
- Every action creates an append-only event record in `dispute_events`.

---

## 5. Dispute Creation & Evidence Linking

### 5.1 Dispute Creation Rules
- Endpoint: `POST /api/v1/escrows/:id/disputes`
- Pre-conditions:
  - User must be an escrow participant (Buyer or Seller) or operational staff.
  - Escrow transaction must be in an eligible state (`PAYMENT_RECEIVED`, `FUNDS_CONFIRMED`, `SELLER_ACCEPTED`, `DELIVERY_PENDING`, `DELIVERED`, `BUYER_CONFIRMED`, `RELEASE_PENDING`).
  - Active dispute check: Only **one active dispute** is permitted per escrow. Duplicate dispute attempts throw `DuplicateActiveDisputeError`.
  - Escrow transaction state automatically transitions to `DISPUTED` using `@escrow-ecuador/domain` state machine.

### 5.2 Evidence Linking
- Evidence can be linked to a dispute during creation (`initialEvidenceIds`) or via `POST /api/v1/disputes/:id/evidence`.
- Linked evidence must belong to the same escrow transaction. Foreign or cross-escrow evidence attachment is rejected.

---

## 6. Financial Freeze & Resolution Integration

### 6.1 Critical Financial Freeze Mechanism
When an active dispute exists or an escrow is in `DISPUTED` state:
1. **Release Blocked**: `ReleaseService.requestRelease` checks for active disputes and throws `FinancialFreezeError`.
2. **Refund Blocked**: `RefundService.requestRefund` checks for active disputes and throws `FinancialFreezeError`.
3. **Audit**: Blocked financial attempts log `RELEASE_BLOCKED_FINANCIAL_FREEZE` or `REFUND_BLOCKED_FINANCIAL_FREEZE` audit events.

### 6.2 Dispute Resolution Financial Actions
- **`RESOLVED_BUYER`**:
  1. Dispute status transitions to `RESOLVED_BUYER`.
  2. `DisputeResolutionService` invokes `RefundService.requestRefund` with flag `isDisputeResolution: true`.
  3. Fiduciary provider executes refund and double-entry ledger posts Debit: `2010_CUSTOMER_ESCROW_HOLDING` / Credit: `1010_BANK_REFUND_CLEARING`.
  4. Escrow status transitions to `REFUNDED`.

- **`RESOLVED_SELLER`**:
  1. Dispute status transitions to `RESOLVED_SELLER`.
  2. `DisputeResolutionService` invokes `ReleaseService.requestRelease` with flag `isDisputeResolution: true`.
  3. Fiduciary provider executes release and double-entry ledger posts Debit: `2010_CUSTOMER_ESCROW_HOLDING` / Credit: `1020_BANK_PAYOUT_CLEARING`.
  4. Escrow status transitions to `RELEASED`.

- **`RESOLVED_SPLIT`**:
  - Dispute status transitions to `RESOLVED_SPLIT`.
  - Audits resolution text stating that partial settlement is marked and requires future explicit partial release/refund capability. No direct balance or fake ledger manipulation is performed.

---

## 7. Dispute Deadlines & Workload Assignment

### 7.1 Configurable Deadlines
- `DisputeDeadlineService` manages deadlines (`EVIDENCE_SUBMISSION`, `BUYER_RESPONSE`, `SELLER_RESPONSE`, `OPERATIONAL_REVIEW`).
- Timestamps stored in UTC (`TIMESTAMPTZ`).
- Expired deadlines mark status as `EXPIRED` and trigger operational review audit events.
- **Money Guard**: Deadline expiration **does not** automatically move funds or resolve disputes.

### 7.2 Assignment Management
- Operational staff (`SUPPORT`, `ADMIN`, `SUPER_ADMIN`) can assign disputes to team members using `DisputeService.assignDispute`.
- Assignment to non-operational roles is blocked to prevent privilege escalation.

---

## 8. Database Schema Extension (Migration `003_evidence_disputes.sql`)

1. **`evidence`**: Extended with `description`, `mime_type`, `file_size`, `original_filename`, `captured_at`, `status`, `visibility`, `replaced_by_id`, `ip_address`, `user_agent`.
2. **`evidence_access_events`**: Append-only log of evidence access events (`evidence_id`, `actor_id`, `action`, `ip_address`, `user_agent`, `accessed_at`).
3. **`disputes`**: Extended with `assigned_to`, `resolution_reason`.
4. **`dispute_events`**: Append-only log of dispute state actions (`dispute_id`, `previous_status`, `new_status`, `actor_id`, `actor_role`, `action`, `reason`, `metadata`, `created_at`).
5. **`dispute_evidence`**: Unique link table `(dispute_id, evidence_id)` with `submitted_by`, `requested_by`.
6. **`dispute_assignments`**: Log of dispute staff assignment history.
7. **`dispute_deadlines`**: Dispute deadlines tracking (`deadline_type`, `due_at`, `status`, `expired_at`).

---

## 9. Notification Event Hooks

`NotificationHookRegistry` provides an decoupled in-memory event emitter abstraction for dispute and evidence lifecycle events:
- `DISPUTE_CREATED`
- `EVIDENCE_REQUESTED`
- `EVIDENCE_SUBMITTED`
- `DISPUTE_ASSIGNED`
- `DISPUTE_ESCALATED`
- `DISPUTE_RESOLVED`
- `DISPUTE_CLOSED`
- `EVIDENCE_INTEGRITY_FAILURE`

Listener exceptions fail safely and do not interfere with core transaction or dispute state transitions.

---

## 10. Audit Trail Completeness & Safety Summary

- **Append-Only Guarantees**: Dispute events, evidence access logs, and audit logs are append-only.
- **Zero Raw Credential Storage**: No PAN, CVV, passwords, tokens, or raw payment credentials are stored or logged.
- **Double-Entry Ledger Integrity**: Debits strictly equal Credits before posting.
- **Environment Report**: Tests execute against `PgMemDbClient`; real PostgreSQL 16 server validation remains pending.
- **Real Money Moved**: $0.00.
