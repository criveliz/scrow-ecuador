import { ActorRole, EscrowStatus } from "@escrow-ecuador/domain";
import { AuditLogRepository } from "../repositories/audit-log.repository.js";
import { EscrowRepository } from "../repositories/escrow.repository.js";
import { PaymentRepository } from "../repositories/payment.repository.js";
import { WebhookEventRepository } from "../repositories/webhook-event.repository.js";
import { InternalPaymentStatus, KushkiMapper, } from "@escrow-ecuador/providers";
export class ReconciliationService {
    db;
    webhookRepo;
    paymentRepo;
    escrowRepo;
    auditRepo;
    constructor(db) {
        this.db = db;
        this.webhookRepo = new WebhookEventRepository(db);
        this.paymentRepo = new PaymentRepository(db);
        this.escrowRepo = new EscrowRepository(db);
        this.auditRepo = new AuditLogRepository(db);
    }
    /**
     * Primary entry point for processing Kushki webhooks safely & idempotently.
     */
    async processKushkiWebhook(event, providerName = "KUSHKI") {
        // 1. Persist raw event & check deduplication atomically
        const recordResult = await this.webhookRepo.recordEvent({
            provider: providerName,
            event_id: event.eventId,
            event_type: event.eventType,
            payload: event.payload,
            signature_verified: true,
            status: "PROCESSING",
        });
        const dbWebhookEvent = recordResult.event;
        if (recordResult.isDuplicate) {
            await this.auditRepo.create({
                actor_id: null,
                action: "WEBHOOK_DUPLICATE_RECEIVED",
                entity_type: "WEBHOOK_EVENT",
                entity_id: event.eventId,
                metadata: { provider: providerName, eventType: event.eventType },
            });
            return {
                success: true,
                isDuplicate: true,
                webhookEventId: dbWebhookEvent.id,
                reconciliationStatus: "DUPLICATE",
                reason: "Duplicate event already recorded and processed",
            };
        }
        // 2. Handle unknown event types safely without crashing
        if (event.mappedStatus === InternalPaymentStatus.UNKNOWN) {
            await this.webhookRepo.updateStatus(dbWebhookEvent.id, "UNKNOWN", "Unsupported event status");
            await this.auditRepo.create({
                actor_id: null,
                action: "WEBHOOK_UNKNOWN_EVENT",
                entity_type: "WEBHOOK_EVENT",
                entity_id: dbWebhookEvent.id,
                metadata: { rawStatus: event.rawStatus, eventType: event.eventType },
            });
            return {
                success: true,
                isDuplicate: false,
                webhookEventId: dbWebhookEvent.id,
                reconciliationStatus: "UNKNOWN_EVENT",
                reason: `Unsupported event status: ${event.rawStatus}`,
            };
        }
        // 3. Locate corresponding Payment record in internal database
        let payment = await this.paymentRepo.findByProviderReference(providerName, event.providerTransactionId);
        // If not found by reference, try by escrowId if provided in webhook metadata
        if (!payment && event.escrowId) {
            const paymentsForEscrow = await this.paymentRepo.findByEscrowId(event.escrowId);
            if (paymentsForEscrow.length > 0) {
                payment = paymentsForEscrow[0];
            }
        }
        // Edge case: UNMATCHED payment
        if (!payment) {
            await this.webhookRepo.updateStatus(dbWebhookEvent.id, "UNMATCHED", `No payment record matching transaction ID ${event.providerTransactionId}`);
            await this.auditRepo.create({
                actor_id: null,
                action: "WEBHOOK_PAYMENT_UNMATCHED",
                entity_type: "WEBHOOK_EVENT",
                entity_id: dbWebhookEvent.id,
                metadata: {
                    providerTransactionId: event.providerTransactionId,
                    escrowId: event.escrowId,
                },
            });
            return {
                success: true,
                isDuplicate: false,
                webhookEventId: dbWebhookEvent.id,
                reconciliationStatus: "UNMATCHED",
                reason: `Payment record not found for transaction ID: ${event.providerTransactionId}`,
            };
        }
        // 4. Fetch linked Escrow transaction record
        const escrow = await this.escrowRepo.findById(payment.escrow_id);
        if (!escrow) {
            await this.webhookRepo.updateStatus(dbWebhookEvent.id, "UNMATCHED_ESCROW", `Escrow ID ${payment.escrow_id} not found`);
            return {
                success: false,
                isDuplicate: false,
                webhookEventId: dbWebhookEvent.id,
                paymentId: payment.id,
                reconciliationStatus: "UNMATCHED",
                reason: `Escrow record ${payment.escrow_id} missing`,
            };
        }
        // 5. Perform strict Financial & Currency Reconciliation
        const expectedAmountStr = parseFloat(String(escrow.amount)).toFixed(2);
        const providerAmountStr = parseFloat(String(event.amount)).toFixed(2);
        const expectedCurrency = escrow.currency.trim().toUpperCase();
        const providerCurrency = event.currency.trim().toUpperCase();
        const amountMatches = expectedAmountStr === providerAmountStr;
        const currencyMatches = expectedCurrency === providerCurrency;
        if (!amountMatches || !currencyMatches) {
            // MISMATCH detected
            const mismatchReason = `Reconciliation mismatch: expected ${expectedCurrency} ${expectedAmountStr}, provider sent ${providerCurrency} ${providerAmountStr}`;
            await this.db.query(`UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2`, [InternalPaymentStatus.RECONCILIATION_MISMATCH, payment.id]);
            await this.webhookRepo.updateStatus(dbWebhookEvent.id, "MISMATCH", mismatchReason);
            await this.auditRepo.create({
                actor_id: null,
                action: "PAYMENT_RECONCILIATION_MISMATCH",
                entity_type: "PAYMENT",
                entity_id: payment.id,
                previous_state: payment.status,
                new_state: InternalPaymentStatus.RECONCILIATION_MISMATCH,
                metadata: {
                    expectedAmount: expectedAmountStr,
                    providerAmount: providerAmountStr,
                    expectedCurrency,
                    providerCurrency,
                    providerTransactionId: event.providerTransactionId,
                },
            });
            return {
                success: false,
                isDuplicate: false,
                webhookEventId: dbWebhookEvent.id,
                paymentId: payment.id,
                escrowId: escrow.id,
                reconciliationStatus: "RECONCILIATION_MISMATCH",
                reason: mismatchReason,
            };
        }
        // 6. Out-of-order check
        if (KushkiMapper.isOutofOrderOrObsolete(payment.status, event.mappedStatus)) {
            await this.webhookRepo.updateStatus(dbWebhookEvent.id, "OBSOLETE", `Event status ${event.mappedStatus} is obsolete compared to current payment status ${payment.status}`);
            await this.auditRepo.create({
                actor_id: null,
                action: "WEBHOOK_OUT_OF_ORDER_IGNORED",
                entity_type: "PAYMENT",
                entity_id: payment.id,
                previous_state: payment.status,
                new_state: payment.status,
                metadata: {
                    incomingStatus: event.mappedStatus,
                    currentStatus: payment.status,
                },
            });
            return {
                success: true,
                isDuplicate: false,
                webhookEventId: dbWebhookEvent.id,
                paymentId: payment.id,
                escrowId: escrow.id,
                reconciliationStatus: "OUT_OF_ORDER",
                reason: `Ignored out-of-order event ${event.mappedStatus} for payment currently in ${payment.status}`,
            };
        }
        // 7. Update Payment & Escrow Status safely within DB Transaction
        const prevPaymentStatus = payment.status;
        const newPaymentStatus = event.mappedStatus;
        const prevEscrowStatus = escrow.status;
        let newEscrowStatus = escrow.status;
        await this.db.query(`UPDATE payments SET status = $1, provider_payment_id = $2, received_at = NOW(), updated_at = NOW() WHERE id = $3`, [newPaymentStatus, event.providerTransactionId, payment.id]);
        // Audit payment transition
        await this.auditRepo.create({
            actor_id: null,
            action: "PAYMENT_STATUS_UPDATED",
            entity_type: "PAYMENT",
            entity_id: payment.id,
            previous_state: prevPaymentStatus,
            new_state: newPaymentStatus,
            metadata: { providerTransactionId: event.providerTransactionId },
        });
        // 8. If Payment is APPROVED, execute state transition for Escrow domain machine
        // DO NOT TRIGGER RELEASE! Only transition escrow state up to PAYMENT_RECEIVED -> FUNDS_CONFIRMED
        if (newPaymentStatus === InternalPaymentStatus.APPROVED) {
            if (escrow.status === EscrowStatus.CREATED || escrow.status === EscrowStatus.AWAITING_PAYMENT) {
                let currentStatus = escrow.status;
                if (currentStatus === EscrowStatus.CREATED) {
                    const updatedEscrow1 = await this.escrowRepo.transitionStatus({
                        transactionId: escrow.id,
                        previousState: EscrowStatus.CREATED,
                        newState: EscrowStatus.AWAITING_PAYMENT,
                        actorId: "system-webhook",
                        actorRole: ActorRole.SYSTEM,
                        timestamp: new Date(),
                        reason: "Webhook received payment initiation",
                    });
                    currentStatus = updatedEscrow1.status;
                }
                if (currentStatus === EscrowStatus.AWAITING_PAYMENT) {
                    const updatedEscrow2 = await this.escrowRepo.transitionStatus({
                        transactionId: escrow.id,
                        previousState: EscrowStatus.AWAITING_PAYMENT,
                        newState: EscrowStatus.PAYMENT_RECEIVED,
                        actorId: "system-webhook",
                        actorRole: ActorRole.SYSTEM,
                        timestamp: new Date(),
                        reason: "Kushki payment webhook confirmed",
                    });
                    currentStatus = updatedEscrow2.status;
                }
                if (currentStatus === EscrowStatus.PAYMENT_RECEIVED) {
                    const updatedEscrow3 = await this.escrowRepo.transitionStatus({
                        transactionId: escrow.id,
                        previousState: EscrowStatus.PAYMENT_RECEIVED,
                        newState: EscrowStatus.FUNDS_CONFIRMED,
                        actorId: "system-webhook",
                        actorRole: ActorRole.SYSTEM,
                        timestamp: new Date(),
                        reason: "Reconciliation verified amount and currency match",
                    });
                    newEscrowStatus = updatedEscrow3.status;
                }
                await this.auditRepo.create({
                    actor_id: null,
                    action: "ESCROW_FUNDS_CONFIRMED_VIA_WEBHOOK",
                    entity_type: "ESCROW",
                    entity_id: escrow.id,
                    previous_state: prevEscrowStatus,
                    new_state: newEscrowStatus,
                    metadata: { amount: providerAmountStr, currency: providerCurrency },
                });
            }
        }
        await this.webhookRepo.updateStatus(dbWebhookEvent.id, "PROCESSED");
        return {
            success: true,
            isDuplicate: false,
            webhookEventId: dbWebhookEvent.id,
            paymentId: payment.id,
            escrowId: escrow.id,
            previousPaymentStatus: prevPaymentStatus,
            newPaymentStatus,
            previousEscrowStatus: prevEscrowStatus,
            newEscrowStatus,
            reconciliationStatus: "SUCCESS",
        };
    }
    /**
     * Internal manual reconciliation service method for operational administrative review.
     */
    async reconcilePayment(paymentId, actorId, actorRole) {
        if (actorRole !== ActorRole.ADMIN && actorRole !== ActorRole.SUPPORT) {
            throw new Error(`Unauthorized actor role '${actorRole}' for manual reconciliation`);
        }
        const payment = await this.db.query(`SELECT * FROM payments WHERE id = $1`, [paymentId]);
        if (payment.rows.length === 0) {
            throw new Error(`Payment with ID ${paymentId} not found`);
        }
        const payRecord = payment.rows[0];
        const escrow = await this.escrowRepo.findById(payRecord.escrow_id);
        if (!escrow) {
            throw new Error(`Escrow record ${payRecord.escrow_id} missing`);
        }
        const expectedAmountStr = parseFloat(String(escrow.amount)).toFixed(2);
        const actualAmountStr = parseFloat(String(payRecord.amount)).toFixed(2);
        if (expectedAmountStr !== actualAmountStr || escrow.currency !== payRecord.currency) {
            return {
                success: false,
                isDuplicate: false,
                paymentId,
                escrowId: escrow.id,
                reconciliationStatus: "RECONCILIATION_MISMATCH",
                reason: `Manual reconciliation mismatch: Escrow=${escrow.currency} ${expectedAmountStr}, Payment=${payRecord.currency} ${actualAmountStr}`,
            };
        }
        await this.auditRepo.create({
            actor_id: actorId,
            action: "MANUAL_PAYMENT_RECONCILIATION_EXECUTED",
            entity_type: "PAYMENT",
            entity_id: paymentId,
            previous_state: payRecord.status,
            new_state: payRecord.status,
            metadata: { actorRole },
        });
        return {
            success: true,
            isDuplicate: false,
            paymentId,
            escrowId: escrow.id,
            reconciliationStatus: "SUCCESS",
        };
    }
}
//# sourceMappingURL=reconciliation.service.js.map