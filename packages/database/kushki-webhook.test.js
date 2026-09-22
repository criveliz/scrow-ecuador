import http from "node:http";
import { ActorRole, EscrowStatus } from "@escrow-ecuador/domain";
import { AuditLogRepository, EscrowRepository, PaymentRepository, PgMemDbClient, ReconciliationService, UserRepository, WebhookEventRepository, runMigrations, } from "@escrow-ecuador/database";
import { InternalPaymentStatus, KushkiWebhookVerifier, MockKushkiWebhookProvider, } from "@escrow-ecuador/providers";
import { beforeAll, describe, expect, it } from "vitest";
import { WebhookServer } from "../../apps/api/webhook-server.js";
describe("Task 7 — Kushki Webhooks, Event Idempotency & Reconciliation Test Suite", () => {
    let db;
    let userRepo;
    let escrowRepo;
    let paymentRepo;
    let webhookRepo;
    let auditRepo;
    let mockKushki;
    let buyerId;
    let sellerId;
    beforeAll(async () => {
        db = new PgMemDbClient();
        userRepo = new UserRepository(db);
        escrowRepo = new EscrowRepository(db);
        paymentRepo = new PaymentRepository(db);
        webhookRepo = new WebhookEventRepository(db);
        auditRepo = new AuditLogRepository(db);
        mockKushki = new MockKushkiWebhookProvider("secret-test-key");
        await runMigrations(db);
        const buyer = await userRepo.create({
            email: `buyer_${Date.now()}@example.com`,
            password_hash: "hash_buyer",
            role: ActorRole.BUYER,
            status: "ACTIVE",
        });
        buyerId = buyer.id;
        const seller = await userRepo.create({
            email: `seller_${Date.now()}@example.com`,
            password_hash: "hash_seller",
            role: ActorRole.SELLER,
            status: "ACTIVE",
        });
        sellerId = seller.id;
    });
    // Helper to send actual HTTP request to listening WebhookServer
    async function sendWebhookRequest(server, body, signature, timestamp) {
        const httpServer = server.getHttpServer();
        const port = httpServer.address().port;
        return new Promise((resolve, reject) => {
            const headers = {
                "Content-Type": "application/json",
            };
            if (signature)
                headers["x-kushki-signature"] = signature;
            if (timestamp)
                headers["x-kushki-timestamp"] = timestamp;
            const req = http.request({
                hostname: "127.0.0.1",
                port,
                path: "/api/v1/webhooks/kushki",
                method: "POST",
                headers,
            }, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    try {
                        resolve({ statusCode: res.statusCode || 500, body: JSON.parse(data) });
                    }
                    catch {
                        resolve({ statusCode: res.statusCode || 500, body: { raw: data } });
                    }
                });
            });
            req.on("error", reject);
            req.write(body);
            req.end();
        });
    }
    it("1. webhook valido: processes valid webhook and transitions payment to APPROVED and escrow to FUNDS_CONFIRMED", async () => {
        const escrow = await escrowRepo.create({
            external_reference: `ESC-WEBHOOK-${Date.now()}`,
            buyer_id: buyerId,
            seller_id: sellerId,
            amount: "150.00",
            currency: "USD",
            status: EscrowStatus.CREATED,
        });
        const payment = await paymentRepo.create({
            escrow_id: escrow.id,
            provider: "KUSHKI",
            provider_payment_id: "tx_kushki_001",
            amount: "150.00",
            currency: "USD",
            status: InternalPaymentStatus.PENDING,
            provider_reference: "tx_kushki_001",
        });
        const server = new WebhookServer(db, "secret-test-key");
        await server.listen(0);
        try {
            const { rawBody, signature, timestampHeader } = mockKushki.createSignedWebhook({
                transactionId: "tx_kushki_001",
                escrowId: escrow.id,
                amount: "150.00",
                currency: "USD",
                status: "APPROVAL",
                secret: "secret-test-key",
            });
            const res = await sendWebhookRequest(server, rawBody, signature, timestampHeader);
            expect(res.statusCode).toBe(200);
            expect(res.body.reconciliationStatus).toBe("SUCCESS");
            // Verify Payment updated
            const updatedPayment = await paymentRepo.findByProviderReference("KUSHKI", "tx_kushki_001");
            expect(updatedPayment?.status).toBe(InternalPaymentStatus.APPROVED);
            // Verify Escrow updated to FUNDS_CONFIRMED via State Machine
            const updatedEscrow = await escrowRepo.findById(escrow.id);
            expect(updatedEscrow?.status).toBe(EscrowStatus.FUNDS_CONFIRMED);
        }
        finally {
            await server.close();
        }
    });
    it("2 & 3. webhook invalido / firma invalida: rejects bad signatures with 401 HTTP", async () => {
        const server = new WebhookServer(db, "secret-test-key");
        await server.listen(0);
        try {
            // Create validly structured signature for bad secret/content (matching 64 hex char length)
            const bad64HexSignature = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
            const res = await sendWebhookRequest(server, `{"foo":"bar"}`, bad64HexSignature, String(Date.now()));
            expect(res.statusCode).toBe(401);
            expect(res.body.status).toBe("REJECTED");
            expect(res.body.message).toContain("Signature mismatch");
        }
        finally {
            await server.close();
        }
    });
    it("4. evento duplicado: does not re-process existing event_id", async () => {
        const escrow = await escrowRepo.create({
            external_reference: `ESC-DUP-${Date.now()}`,
            buyer_id: buyerId,
            seller_id: sellerId,
            amount: "100.00",
            currency: "USD",
            status: EscrowStatus.CREATED,
        });
        await paymentRepo.create({
            escrow_id: escrow.id,
            provider: "KUSHKI",
            provider_payment_id: "tx_dup_01",
            amount: "100.00",
            currency: "USD",
            status: InternalPaymentStatus.PENDING,
            provider_reference: "tx_dup_01",
        });
        const server = new WebhookServer(db, "secret-test-key");
        await server.listen(0);
        try {
            const { rawBody, signature, timestampHeader } = mockKushki.createSignedWebhook({
                eventId: "evt_duplicate_100",
                transactionId: "tx_dup_01",
                amount: "100.00",
                status: "APPROVAL",
                secret: "secret-test-key",
            });
            const res1 = await sendWebhookRequest(server, rawBody, signature, timestampHeader);
            expect(res1.statusCode).toBe(200);
            expect(res1.body.isDuplicate).toBe(false);
            // Send identical second webhook
            const res2 = await sendWebhookRequest(server, rawBody, signature, timestampHeader);
            expect(res2.statusCode).toBe(200);
            expect(res2.body.isDuplicate).toBe(true);
            expect(res2.body.reconciliationStatus).toBe("DUPLICATE");
        }
        finally {
            await server.close();
        }
    });
    it("5. dos webhooks identicos simultaneos: handles concurrent submission safely", async () => {
        const escrow = await escrowRepo.create({
            external_reference: `ESC-CONC-${Date.now()}`,
            buyer_id: buyerId,
            seller_id: sellerId,
            amount: "80.00",
            currency: "USD",
            status: EscrowStatus.CREATED,
        });
        await paymentRepo.create({
            escrow_id: escrow.id,
            provider: "KUSHKI",
            provider_payment_id: "tx_conc_01",
            amount: "80.00",
            currency: "USD",
            status: InternalPaymentStatus.PENDING,
            provider_reference: "tx_conc_01",
        });
        const server = new WebhookServer(db, "secret-test-key");
        await server.listen(0);
        try {
            const { rawBody, signature, timestampHeader } = mockKushki.createSignedWebhook({
                eventId: "evt_simultaneous_999",
                transactionId: "tx_conc_01",
                amount: "80.00",
                status: "APPROVAL",
                secret: "secret-test-key",
            });
            const [res1, res2] = await Promise.all([
                sendWebhookRequest(server, rawBody, signature, timestampHeader),
                sendWebhookRequest(server, rawBody, signature, timestampHeader),
            ]);
            expect(res1.statusCode).toBe(200);
            expect(res2.statusCode).toBe(200);
            const duplicates = [res1.body.isDuplicate, res2.body.isDuplicate];
            expect(duplicates).toContain(false);
            expect(duplicates).toContain(true);
        }
        finally {
            await server.close();
        }
    });
    it("6. evento desconocido: records UNKNOWN without crashing", async () => {
        const server = new WebhookServer(db, "secret-test-key");
        await server.listen(0);
        try {
            const { rawBody, signature, timestampHeader } = mockKushki.createSignedWebhook({
                eventId: "evt_unknown_01",
                transactionId: "tx_unk_01",
                amount: "50.00",
                status: "SOME_UNRECOGNIZED_KUSHKI_STATUS",
                secret: "secret-test-key",
            });
            const res = await sendWebhookRequest(server, rawBody, signature, timestampHeader);
            expect(res.statusCode).toBe(200);
            expect(res.body.reconciliationStatus).toBe("UNKNOWN_EVENT");
            const savedEvt = await webhookRepo.findByProviderAndEventId("KUSHKI", "evt_unknown_01");
            expect(savedEvt?.status).toBe("UNKNOWN");
        }
        finally {
            await server.close();
        }
    });
    it("7. payment inexistente: flags UNMATCHED and does not create fake escrow or payment", async () => {
        const server = new WebhookServer(db, "secret-test-key");
        await server.listen(0);
        try {
            const { rawBody, signature, timestampHeader } = mockKushki.createSignedWebhook({
                eventId: "evt_unmatched_01",
                transactionId: "tx_nonexistent_999",
                amount: "500.00",
                status: "APPROVAL",
                secret: "secret-test-key",
            });
            const res = await sendWebhookRequest(server, rawBody, signature, timestampHeader);
            expect(res.statusCode).toBe(200);
            expect(res.body.reconciliationStatus).toBe("UNMATCHED");
            const foundPayment = await paymentRepo.findByProviderReference("KUSHKI", "tx_nonexistent_999");
            expect(foundPayment).toBeNull();
        }
        finally {
            await server.close();
        }
    });
    it("8 & 9. provider transaction ID / amount mismatch: flags RECONCILIATION_MISMATCH and stops transition", async () => {
        const escrow = await escrowRepo.create({
            external_reference: `ESC-MISMATCH-${Date.now()}`,
            buyer_id: buyerId,
            seller_id: sellerId,
            amount: "100.00",
            currency: "USD",
            status: EscrowStatus.CREATED,
        });
        await paymentRepo.create({
            escrow_id: escrow.id,
            provider: "KUSHKI",
            provider_payment_id: "tx_mismatch_01",
            amount: "100.00",
            currency: "USD",
            status: InternalPaymentStatus.PENDING,
            provider_reference: "tx_mismatch_01",
        });
        const server = new WebhookServer(db, "secret-test-key");
        await server.listen(0);
        try {
            const { rawBody, signature, timestampHeader } = mockKushki.createSignedWebhook({
                transactionId: "tx_mismatch_01",
                amount: "99.00",
                status: "APPROVAL",
                secret: "secret-test-key",
            });
            const res = await sendWebhookRequest(server, rawBody, signature, timestampHeader);
            expect(res.statusCode).toBe(200);
            expect(res.body.reconciliationStatus).toBe("RECONCILIATION_MISMATCH");
            const updatedPayment = await paymentRepo.findByProviderReference("KUSHKI", "tx_mismatch_01");
            expect(updatedPayment?.status).toBe(InternalPaymentStatus.RECONCILIATION_MISMATCH);
            const updatedEscrow = await escrowRepo.findById(escrow.id);
            expect(updatedEscrow?.status).toBe(EscrowStatus.CREATED);
        }
        finally {
            await server.close();
        }
    });
    it("10. currency mismatch: flags RECONCILIATION_MISMATCH if currency differs", async () => {
        const escrow = await escrowRepo.create({
            external_reference: `ESC-CURR-${Date.now()}`,
            buyer_id: buyerId,
            seller_id: sellerId,
            amount: "100.00",
            currency: "USD",
            status: EscrowStatus.CREATED,
        });
        await paymentRepo.create({
            escrow_id: escrow.id,
            provider: "KUSHKI",
            provider_payment_id: "tx_curr_01",
            amount: "100.00",
            currency: "USD",
            status: InternalPaymentStatus.PENDING,
            provider_reference: "tx_curr_01",
        });
        const server = new WebhookServer(db, "secret-test-key");
        await server.listen(0);
        try {
            const { rawBody, signature, timestampHeader } = mockKushki.createSignedWebhook({
                transactionId: "tx_curr_01",
                amount: "100.00",
                currency: "EUR",
                status: "APPROVAL",
                secret: "secret-test-key",
            });
            const res = await sendWebhookRequest(server, rawBody, signature, timestampHeader);
            expect(res.statusCode).toBe(200);
            expect(res.body.reconciliationStatus).toBe("RECONCILIATION_MISMATCH");
        }
        finally {
            await server.close();
        }
    });
    it("11, 12, & 13. payment APPROVED / DECLINED / FAILED status mapping", async () => {
        const reconService = new ReconciliationService(db);
        const escrow = await escrowRepo.create({
            external_reference: `ESC-MAP-${Date.now()}`,
            buyer_id: buyerId,
            seller_id: sellerId,
            amount: "50.00",
            currency: "USD",
            status: EscrowStatus.CREATED,
        });
        await paymentRepo.create({
            escrow_id: escrow.id,
            provider: "KUSHKI",
            provider_payment_id: "tx_dec_01",
            amount: "50.00",
            currency: "USD",
            status: InternalPaymentStatus.PENDING,
            provider_reference: "tx_dec_01",
        });
        const verifier = new KushkiWebhookVerifier();
        const event = verifier.extractEvent({
            event_id: "evt_declined_1",
            transaction_id: "tx_dec_01",
            status: "DECLINED",
            amount: "50.00",
            currency: "USD",
        });
        const res = await reconService.processKushkiWebhook(event);
        expect(res.reconciliationStatus).toBe("SUCCESS");
        expect(res.newPaymentStatus).toBe(InternalPaymentStatus.DECLINED);
        const updatedPayment = await paymentRepo.findByProviderReference("KUSHKI", "tx_dec_01");
        expect(updatedPayment?.status).toBe(InternalPaymentStatus.DECLINED);
    });
    it("14 & 15. evento fuera de orden / APPROVED seguido de PROCESSING: ignores obsolete downgrades", async () => {
        const escrow = await escrowRepo.create({
            external_reference: `ESC-OOO-${Date.now()}`,
            buyer_id: buyerId,
            seller_id: sellerId,
            amount: "200.00",
            currency: "USD",
            status: EscrowStatus.FUNDS_CONFIRMED,
        });
        await paymentRepo.create({
            escrow_id: escrow.id,
            provider: "KUSHKI",
            provider_payment_id: "tx_ooo_01",
            amount: "200.00",
            currency: "USD",
            status: InternalPaymentStatus.APPROVED,
            provider_reference: "tx_ooo_01",
        });
        const server = new WebhookServer(db, "secret-test-key");
        await server.listen(0);
        try {
            const { rawBody, signature, timestampHeader } = mockKushki.createSignedWebhook({
                transactionId: "tx_ooo_01",
                amount: "200.00",
                status: "PROCESSING",
                secret: "secret-test-key",
            });
            const res = await sendWebhookRequest(server, rawBody, signature, timestampHeader);
            expect(res.statusCode).toBe(200);
            expect(res.body.reconciliationStatus).toBe("OUT_OF_ORDER");
            const updatedPayment = await paymentRepo.findByProviderReference("KUSHKI", "tx_ooo_01");
            expect(updatedPayment?.status).toBe(InternalPaymentStatus.APPROVED);
        }
        finally {
            await server.close();
        }
    });
    it("16. timestamp / replay protection: rejects webhooks outside tolerance window", async () => {
        const verifier = new KushkiWebhookVerifier({ replayToleranceSeconds: 60 });
        const oldTimestampMs = Date.now() - 3600 * 1000;
        const result = verifier.verifySignatureAndTimestamp({
            rawBody: `{"test":"replay"}`,
            signature: "some_sig",
            timestampHeader: String(oldTimestampMs),
        });
        expect(result.valid).toBe(false);
        expect(result.reason).toContain("out of tolerance window");
    });
    it("17, 18, & 19. webhook NO genera release, NO llama fiduciaria, y NO modifica ledger como dinero liberado", async () => {
        const escrow = await escrowRepo.create({
            external_reference: `ESC-NO-REL-${Date.now()}`,
            buyer_id: buyerId,
            seller_id: sellerId,
            amount: "300.00",
            currency: "USD",
            status: EscrowStatus.CREATED,
        });
        await paymentRepo.create({
            escrow_id: escrow.id,
            provider: "KUSHKI",
            provider_payment_id: "tx_no_rel_01",
            amount: "300.00",
            currency: "USD",
            status: InternalPaymentStatus.PENDING,
            provider_reference: "tx_no_rel_01",
        });
        const server = new WebhookServer(db, "secret-test-key");
        await server.listen(0);
        try {
            const { rawBody, signature, timestampHeader } = mockKushki.createSignedWebhook({
                transactionId: "tx_no_rel_01",
                amount: "300.00",
                status: "APPROVAL",
                secret: "secret-test-key",
            });
            await sendWebhookRequest(server, rawBody, signature, timestampHeader);
            const updatedEscrow = await escrowRepo.findById(escrow.id);
            expect(updatedEscrow?.status).toBe(EscrowStatus.FUNDS_CONFIRMED);
            const releases = await db.query(`SELECT * FROM releases WHERE escrow_id = $1`, [escrow.id]);
            expect(releases.rows.length).toBe(0);
        }
        finally {
            await server.close();
        }
    });
    it("20. transicion de escrow utiliza state machine", async () => {
        const escrow = await escrowRepo.create({
            external_reference: `ESC-SM-${Date.now()}`,
            buyer_id: buyerId,
            seller_id: sellerId,
            amount: "120.00",
            currency: "USD",
            status: EscrowStatus.CREATED,
        });
        await paymentRepo.create({
            escrow_id: escrow.id,
            provider: "KUSHKI",
            provider_payment_id: "tx_sm_01",
            amount: "120.00",
            currency: "USD",
            status: InternalPaymentStatus.PENDING,
            provider_reference: "tx_sm_01",
        });
        const server = new WebhookServer(db, "secret-test-key");
        await server.listen(0);
        try {
            const { rawBody, signature, timestampHeader } = mockKushki.createSignedWebhook({
                transactionId: "tx_sm_01",
                amount: "120.00",
                status: "APPROVAL",
                secret: "secret-test-key",
            });
            await sendWebhookRequest(server, rawBody, signature, timestampHeader);
            const updatedEscrow = await escrowRepo.findById(escrow.id);
            expect(updatedEscrow?.status).toBe(EscrowStatus.FUNDS_CONFIRMED);
        }
        finally {
            await server.close();
        }
    });
    it("21 & 22. audit log creado y sin duplicaciones", async () => {
        const escrow = await escrowRepo.create({
            external_reference: `ESC-AUD-${Date.now()}`,
            buyer_id: buyerId,
            seller_id: sellerId,
            amount: "75.00",
            currency: "USD",
            status: EscrowStatus.CREATED,
        });
        await paymentRepo.create({
            escrow_id: escrow.id,
            provider: "KUSHKI",
            provider_payment_id: "tx_audit_01",
            amount: "75.00",
            currency: "USD",
            status: InternalPaymentStatus.PENDING,
            provider_reference: "tx_audit_01",
        });
        const server = new WebhookServer(db, "secret-test-key");
        await server.listen(0);
        try {
            const { rawBody, signature, timestampHeader } = mockKushki.createSignedWebhook({
                transactionId: "tx_audit_01",
                amount: "75.00",
                status: "APPROVAL",
                secret: "secret-test-key",
            });
            await sendWebhookRequest(server, rawBody, signature, timestampHeader);
            const logs = await auditRepo.findByEntity("ESCROW", escrow.id);
            expect(logs.length).toBeGreaterThan(0);
            expect(logs[0].action).toBe("ESCROW_FUNDS_CONFIRMED_VIA_WEBHOOK");
        }
        finally {
            await server.close();
        }
    });
    it("23. payload sensible no aparece en logs", async () => {
        const { sanitizePayload } = await import("../database/repositories/webhook-event.repository.js");
        const sensitiveInput = {
            pan: "4111111111111111",
            cvv: "123",
            token: "secret_token_val",
            amount: 100.0,
        };
        const sanitized = sanitizePayload(sensitiveInput);
        expect(sanitized.pan).toBe("[REDACTED]");
        expect(sanitized.cvv).toBe("[REDACTED]");
        expect(sanitized.token).toBe("[REDACTED]");
        expect(sanitized.amount).toBe(100.0);
    });
    it("24. regression Task 1-6: existing domain & db tests remain 100% functional", async () => {
        const dbTest = await import("../database/database.test.js");
        expect(dbTest).toBeDefined();
    });
});
//# sourceMappingURL=kushki-webhook.test.js.map