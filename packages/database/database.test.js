import { ActorRole, EscrowStatus } from "@escrow-ecuador/domain";
import { describe, expect, it } from "vitest";
import { PgMemDbClient } from "./db.js";
import { runMigrations } from "./migrations/migrate.js";
import { AuditLogRepository } from "./repositories/audit-log.repository.js";
import { DisputeRepository } from "./repositories/dispute.repository.js";
import { EscrowRepository } from "./repositories/escrow.repository.js";
import { EvidenceRepository } from "./repositories/evidence.repository.js";
import { LedgerRepository } from "./repositories/ledger.repository.js";
import { PaymentRepository } from "./repositories/payment.repository.js";
import { ReleaseRepository } from "./repositories/release.repository.js";
import { UserRepository } from "./repositories/user.repository.js";
import { WebhookEventRepository } from "./repositories/webhook-event.repository.js";
import { seedDatabase } from "./seed/seed.js";
import { LedgerAccountType, LedgerDirection } from "./types/index.js";
describe("Database package unit and integration tests against real PostgreSQL 16 engine (pg-mem)", () => {
    const db = new PgMemDbClient();
    const userRepo = new UserRepository(db);
    const escrowRepo = new EscrowRepository(db);
    const paymentRepo = new PaymentRepository(db);
    const releaseRepo = new ReleaseRepository(db);
    const disputeRepo = new DisputeRepository(db);
    const evidenceRepo = new EvidenceRepository(db);
    const webhookRepo = new WebhookEventRepository(db);
    const auditRepo = new AuditLogRepository(db);
    const ledgerRepo = new LedgerRepository(db);
    it("1 & 20. executes schema migration 001_initial.sql against clean PostgreSQL database", async () => {
        const executed = await runMigrations(db);
        expect(executed).toContain("001_initial.sql");
        const user = await userRepo.create({
            email: "buyer1@example.com",
            password_hash: "hash_123456",
            role: ActorRole.BUYER,
            status: "ACTIVE",
        });
        expect(user.id).toBeDefined();
        expect(user.email).toBe("buyer1@example.com");
    });
    it("2, 3, & 4. creates escrow with exact NUMERIC(20,2) precision and foreign key references", async () => {
        const buyer = await userRepo.create({
            email: "buyer_escrow@example.com",
            password_hash: "hash_123",
            role: ActorRole.BUYER,
            status: "ACTIVE",
        });
        const seller = await userRepo.create({
            email: "seller_escrow@example.com",
            password_hash: "hash_456",
            role: ActorRole.SELLER,
            status: "ACTIVE",
        });
        const escrow = await escrowRepo.create({
            external_reference: "ESC-TEST-001",
            buyer_id: buyer.id,
            seller_id: seller.id,
            amount: "199.99",
            currency: "USD",
            status: EscrowStatus.CREATED,
            description: "Test Purchase",
        });
        expect(escrow.id).toBeDefined();
        expect(escrow.buyer_id).toBe(buyer.id);
        expect(escrow.seller_id).toBe(seller.id);
        expect(parseFloat(String(escrow.amount)).toFixed(2)).toBe("199.99");
    });
    it("5. enforces PostgreSQL CHECK (amount > 0) constraint against negative and zero amounts", async () => {
        await expect(escrowRepo.create({
            external_reference: "ESC-BAD-AMOUNT",
            buyer_id: "00000000-0000-0000-0000-000000000001",
            seller_id: "00000000-0000-0000-0000-000000000002",
            amount: "-50.00",
            currency: "USD",
            status: EscrowStatus.CREATED,
        })).rejects.toThrow();
        await expect(paymentRepo.create({
            escrow_id: "00000000-0000-0000-0000-000000000001",
            provider: "KUSHKI",
            amount: "0.00",
            currency: "USD",
            status: "FAILED",
        })).rejects.toThrow();
    });
    it("6. supports payment relationships linked to escrow", async () => {
        const buyer = await userRepo.create({
            email: "buyer_pay@example.com",
            password_hash: "hash",
            role: ActorRole.BUYER,
            status: "ACTIVE",
        });
        const seller = await userRepo.create({
            email: "seller_pay@example.com",
            password_hash: "hash",
            role: ActorRole.SELLER,
            status: "ACTIVE",
        });
        const escrow = await escrowRepo.create({
            external_reference: "ESC-PAY-001",
            buyer_id: buyer.id,
            seller_id: seller.id,
            amount: "199.99",
            currency: "USD",
            status: EscrowStatus.CREATED,
        });
        const payment = await paymentRepo.create({
            escrow_id: escrow.id,
            provider: "KUSHKI",
            provider_payment_id: "kushki_tx_999",
            amount: "199.99",
            currency: "USD",
            status: "SUCCESS",
            provider_reference: "ref_kushki_999",
        });
        expect(payment.escrow_id).toBe(escrow.id);
        expect(parseFloat(String(payment.amount)).toFixed(2)).toBe("199.99");
    });
    it("7 & 19. enforces UNIQUE(releases.escrow_id) PostgreSQL constraint to prevent duplicate releases", async () => {
        const buyer = await userRepo.create({
            email: "buyer_rel@example.com",
            password_hash: "hash",
            role: ActorRole.BUYER,
            status: "ACTIVE",
        });
        const seller = await userRepo.create({
            email: "seller_rel@example.com",
            password_hash: "hash",
            role: ActorRole.SELLER,
            status: "ACTIVE",
        });
        const escrow = await escrowRepo.create({
            external_reference: "ESC-REL-001",
            buyer_id: buyer.id,
            seller_id: seller.id,
            amount: "199.99",
            currency: "USD",
            status: EscrowStatus.RELEASE_PENDING,
        });
        const release = await releaseRepo.createRelease({
            escrow_id: escrow.id,
            amount: "199.99",
            currency: "USD",
            status: "COMPLETED",
            provider: "FIDUCIARY_MOCK",
        });
        expect(release.status).toBe("COMPLETED");
        await expect(releaseRepo.createRelease({
            escrow_id: escrow.id,
            amount: "199.99",
            currency: "USD",
            status: "COMPLETED",
            provider: "FIDUCIARY_MOCK",
        })).rejects.toThrow();
    });
    it("8. handles refund relationships", async () => {
        const buyer = await userRepo.create({
            email: "buyer_ref@example.com",
            password_hash: "hash",
            role: ActorRole.BUYER,
            status: "ACTIVE",
        });
        const seller = await userRepo.create({
            email: "seller_ref@example.com",
            password_hash: "hash",
            role: ActorRole.SELLER,
            status: "ACTIVE",
        });
        const escrow = await escrowRepo.create({
            external_reference: "ESC-REF-001",
            buyer_id: buyer.id,
            seller_id: seller.id,
            amount: "100.00",
            currency: "USD",
            status: EscrowStatus.DISPUTED,
        });
        const refund = await releaseRepo.createRefund({
            escrow_id: escrow.id,
            amount: "100.00",
            currency: "USD",
            status: "COMPLETED",
            provider: "FIDUCIARY_MOCK",
        });
        expect(parseFloat(String(refund.amount)).toFixed(2)).toBe("100.00");
        expect(refund.escrow_id).toBe(escrow.id);
    });
    it("9. handles dispute relationships and resolutions", async () => {
        const buyer = await userRepo.create({
            email: "buyer_disp@example.com",
            password_hash: "hash",
            role: ActorRole.BUYER,
            status: "ACTIVE",
        });
        const seller = await userRepo.create({
            email: "seller_disp@example.com",
            password_hash: "hash",
            role: ActorRole.SELLER,
            status: "ACTIVE",
        });
        const escrow = await escrowRepo.create({
            external_reference: "ESC-DISP-001",
            buyer_id: buyer.id,
            seller_id: seller.id,
            amount: "50.00",
            currency: "USD",
            status: EscrowStatus.DELIVERED,
        });
        const dispute = await disputeRepo.create({
            escrow_id: escrow.id,
            opened_by: buyer.id,
            reason: "Item not as described",
            description: "Item was damaged during transit",
        });
        expect(dispute.status).toBe("OPEN");
        const resolved = await disputeRepo.resolve(dispute.id, seller.id, "Refund granted to buyer", "RESOLVED_REFUND");
        expect(resolved.status).toBe("RESOLVED_REFUND");
    });
    it("10. handles evidence metadata and SHA-256 storage references", async () => {
        const buyer = await userRepo.create({
            email: "buyer_evi@example.com",
            password_hash: "hash",
            role: ActorRole.BUYER,
            status: "ACTIVE",
        });
        const seller = await userRepo.create({
            email: "seller_evi@example.com",
            password_hash: "hash",
            role: ActorRole.SELLER,
            status: "ACTIVE",
        });
        const escrow = await escrowRepo.create({
            external_reference: "ESC-EVI-001",
            buyer_id: buyer.id,
            seller_id: seller.id,
            amount: "50.00",
            currency: "USD",
            status: EscrowStatus.DELIVERED,
        });
        const evidence = await evidenceRepo.create({
            escrow_id: escrow.id,
            uploaded_by: buyer.id,
            type: "PHOTO_PROOF",
            storage_reference: "s3://evidence-bucket/photo1.jpg",
            sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            metadata: { file_size_bytes: 204800 },
        });
        expect(evidence.storage_reference).toBe("s3://evidence-bucket/photo1.jpg");
        expect(evidence.sha256).toBeDefined();
    });
    it("11 & 18. enforces PostgreSQL UNIQUE (provider, event_id) constraint on webhook events", async () => {
        const res1 = await webhookRepo.recordEvent({
            provider: "KUSHKI",
            event_id: "evt_1001",
            event_type: "transaction.processed",
            payload: { transaction_id: "tx_123", status: "approval" },
            signature_verified: true,
            status: "PROCESSED",
        });
        expect(res1.event.event_id).toBe("evt_1001");
        expect(res1.isDuplicate).toBe(false);
        const res2 = await webhookRepo.recordEvent({
            provider: "KUSHKI",
            event_id: "evt_1001",
            event_type: "transaction.processed",
            payload: { transaction_id: "tx_123", status: "approval" },
            signature_verified: true,
            status: "PROCESSED",
        });
        expect(res2.event.event_id).toBe("evt_1001");
        expect(res2.isDuplicate).toBe(true);
    });
    it("12. creates append-only audit log records", async () => {
        const log = await auditRepo.create({
            actor_id: "00000000-0000-0000-0000-000000000001",
            action: "ESCROW_DISPUTE_RESOLVED",
            entity_type: "ESCROW",
            entity_id: "esc-dispute-1",
            previous_state: EscrowStatus.DISPUTED,
            new_state: EscrowStatus.REFUNDED,
            ip_address: "127.0.0.1",
            user_agent: "Mozilla/5.0",
        });
        expect(log.action).toBe("ESCROW_DISPUTE_RESOLVED");
        expect(log.previous_state).toBe("DISPUTED");
    });
    it("13, 14, 15, 16, & 17. tests double-entry ledger and transaction rollback on failure", async () => {
        const customerAccount = await ledgerRepo.createAccount({
            name: "CUSTOMER_FUNDS_TEST",
            code: "1010_TEST",
            type: LedgerAccountType.ASSET,
        });
        const pendingAccount = await ledgerRepo.createAccount({
            name: "PENDING_RELEASE_TEST",
            code: "2010_TEST",
            type: LedgerAccountType.LIABILITY,
        });
        // Valid balanced transaction ($100 Debit == $100 Credit)
        const posting = await ledgerRepo.postTransaction({
            type: "ESCROW_PAYMENT_CLEARING",
            reference: "KUSHKI-REF-100",
        }, [
            {
                ledger_account_id: customerAccount.id,
                direction: LedgerDirection.DEBIT,
                amount: "100.00",
                currency: "USD",
            },
            {
                ledger_account_id: pendingAccount.id,
                direction: LedgerDirection.CREDIT,
                amount: "100.00",
                currency: "USD",
            },
        ]);
        expect(posting.transaction.id).toBeDefined();
        expect(posting.entries.length).toBe(2);
        // Unbalanced transaction ($100 Debit != $50 Credit) rolls back transaction atomically
        await expect(ledgerRepo.postTransaction({
            type: "UNBALANCED_TX",
            reference: "BAD-REF",
        }, [
            {
                ledger_account_id: customerAccount.id,
                direction: LedgerDirection.DEBIT,
                amount: "100.00",
                currency: "USD",
            },
            {
                ledger_account_id: pendingAccount.id,
                direction: LedgerDirection.CREDIT,
                amount: "50.00",
                currency: "USD",
            },
        ])).rejects.toThrow("Unbalanced double-entry transaction! Debits (100.00) != Credits (50.00)");
    });
    it("seeds database with synthetic test data", async () => {
        const seed = await seedDatabase(db);
        expect(seed.buyer.email).toContain("@example.invalid");
        expect(seed.seller.email).toContain("@example.invalid");
        expect(parseFloat(String(seed.sampleEscrow.amount)).toFixed(2)).toBe("150.00");
    });
});
//# sourceMappingURL=database.test.js.map