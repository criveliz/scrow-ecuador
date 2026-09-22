import { ActorRole, EscrowStatus } from "@escrow-ecuador/domain";
import { runMigrations } from "@escrow-ecuador/database";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createApiServer } from "../index.js";
import { hashPassword } from "../auth/crypto.js";
import { generateToken } from "../auth/jwt.js";
describe("TASK 5 — Escrow REST API Core Tests", () => {
    let app;
    let baseUrl;
    let buyerToken;
    let buyerId;
    let sellerToken;
    let sellerId;
    let userCToken;
    let userCId;
    let adminToken;
    let adminId;
    beforeEach(async () => {
        app = createApiServer();
        await runMigrations(app.db);
        await new Promise((resolve) => {
            app.server.listen(0, () => resolve());
        });
        const address = app.server.address();
        baseUrl = `http://localhost:${address.port}`;
        const buyerUser = await app.userRepo.create({
            email: "buyer_task5@example.com",
            password_hash: await hashPassword("buyerPass123!"),
            role: ActorRole.BUYER,
            status: "ACTIVE",
        });
        buyerId = buyerUser.id;
        buyerToken = generateToken({
            userId: buyerUser.id,
            email: buyerUser.email,
            role: ActorRole.BUYER,
            type: "ACCESS",
        }, 3600);
        const sellerUser = await app.userRepo.create({
            email: "seller_task5@example.com",
            password_hash: await hashPassword("sellerPass123!"),
            role: ActorRole.SELLER,
            status: "ACTIVE",
        });
        sellerId = sellerUser.id;
        sellerToken = generateToken({
            userId: sellerUser.id,
            email: sellerUser.email,
            role: ActorRole.SELLER,
            type: "ACCESS",
        }, 3600);
        const userC = await app.userRepo.create({
            email: "user_c_task5@example.com",
            password_hash: await hashPassword("userCPass123!"),
            role: ActorRole.BUYER,
            status: "ACTIVE",
        });
        userCId = userC.id;
        userCToken = generateToken({
            userId: userC.id,
            email: userC.email,
            role: ActorRole.BUYER,
            type: "ACCESS",
        }, 3600);
        const adminUser = await app.userRepo.create({
            email: "admin_task5@example.com",
            password_hash: await hashPassword("adminPass123!"),
            role: ActorRole.ADMIN,
            status: "ACTIVE",
        });
        adminId = adminUser.id;
        adminToken = generateToken({
            userId: adminUser.id,
            email: adminUser.email,
            role: ActorRole.ADMIN,
            mfaVerified: true,
            type: "ACCESS",
        }, 3600);
    });
    afterEach(async () => {
        await new Promise((resolve) => {
            app.server.close(() => resolve());
        });
    });
    describe("POST /api/v1/escrows — Escrow Creation", () => {
        it("1. creates escrow as authenticated BUYER specifying seller_id", async () => {
            const res = await fetch(`${baseUrl}/api/v1/escrows`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${buyerToken}`,
                },
                body: JSON.stringify({
                    seller_id: sellerId,
                    amount: "150.50",
                    currency: "USD",
                    description: "Laptop purchase",
                }),
            });
            expect(res.status).toBe(201);
            const data = await res.json();
            expect(data.escrow).toBeDefined();
            expect(data.escrow.buyer_id).toBe(buyerId);
            expect(data.escrow.seller_id).toBe(sellerId);
            expect(parseFloat(data.escrow.amount).toFixed(2)).toBe("150.50");
            expect(data.escrow.currency).toBe("USD");
            expect(data.escrow.status).toBe(EscrowStatus.CREATED);
            expect(data.escrow.description).toBe("Laptop purchase");
        });
        it("2. creates escrow as authenticated SELLER specifying buyer_id", async () => {
            const res = await fetch(`${baseUrl}/api/v1/escrows`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${sellerToken}`,
                },
                body: JSON.stringify({
                    buyer_id: buyerId,
                    amount: "299.99",
                    currency: "USD",
                    description: "Smartphone sale",
                }),
            });
            expect(res.status).toBe(201);
            const data = await res.json();
            expect(data.escrow).toBeDefined();
            expect(data.escrow.buyer_id).toBe(buyerId);
            expect(data.escrow.seller_id).toBe(sellerId);
            expect(parseFloat(data.escrow.amount).toFixed(2)).toBe("299.99");
        });
        it("3. rejects unauthenticated creation request with 401", async () => {
            const res = await fetch(`${baseUrl}/api/v1/escrows`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    seller_id: sellerId,
                    amount: "100.00",
                }),
            });
            expect(res.status).toBe(401);
            const data = await res.json();
            expect(data.error).toBe("UNAUTHORIZED");
        });
        it("4. rejects invalid or non-positive amount with 400", async () => {
            const resZero = await fetch(`${baseUrl}/api/v1/escrows`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${buyerToken}`,
                },
                body: JSON.stringify({
                    seller_id: sellerId,
                    amount: "0.00",
                }),
            });
            expect(resZero.status).toBe(400);
            const resNegative = await fetch(`${baseUrl}/api/v1/escrows`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${buyerToken}`,
                },
                body: JSON.stringify({
                    seller_id: sellerId,
                    amount: "-50.00",
                }),
            });
            expect(resNegative.status).toBe(400);
            const resInvalidString = await fetch(`${baseUrl}/api/v1/escrows`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${buyerToken}`,
                },
                body: JSON.stringify({
                    seller_id: sellerId,
                    amount: "invalid-number",
                }),
            });
            expect(resInvalidString.status).toBe(400);
        });
        it("5. rejects invalid currency ISO code with 400", async () => {
            const res = await fetch(`${baseUrl}/api/v1/escrows`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${buyerToken}`,
                },
                body: JSON.stringify({
                    seller_id: sellerId,
                    amount: "100.00",
                    currency: "INVALID_CURRENCY",
                }),
            });
            expect(res.status).toBe(400);
        });
        it("6. rejects creation if buyer and seller are the same user", async () => {
            const res = await fetch(`${baseUrl}/api/v1/escrows`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${buyerToken}`,
                },
                body: JSON.stringify({
                    seller_id: buyerId,
                    amount: "100.00",
                }),
            });
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.message).toContain("cannot be the same user");
        });
        it("7. ignores client mass assignment attempts for status/payment/released fields", async () => {
            const res = await fetch(`${baseUrl}/api/v1/escrows`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${buyerToken}`,
                },
                body: JSON.stringify({
                    seller_id: sellerId,
                    amount: "100.00",
                    status: "RELEASED",
                    released: true,
                    payment_status: "PAID",
                    ledger_state: "CONFIRMED",
                }),
            });
            expect(res.status).toBe(201);
            const data = await res.json();
            expect(data.escrow.status).toBe(EscrowStatus.CREATED);
            expect(data.escrow.released).toBeUndefined();
        });
        it("8. supports idempotency key: duplicate request returns original response", async () => {
            const idempotencyKey = "key-create-12345";
            const payload = {
                seller_id: sellerId,
                amount: "500.00",
                description: "Idempotent creation",
            };
            const res1 = await fetch(`${baseUrl}/api/v1/escrows`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${buyerToken}`,
                    "Idempotency-Key": idempotencyKey,
                },
                body: JSON.stringify(payload),
            });
            expect(res1.status).toBe(201);
            const data1 = await res1.json();
            const res2 = await fetch(`${baseUrl}/api/v1/escrows`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${buyerToken}`,
                    "Idempotency-Key": idempotencyKey,
                },
                body: JSON.stringify(payload),
            });
            expect(res2.status).toBe(201);
            const data2 = await res2.json();
            expect(data2.escrow.id).toBe(data1.escrow.id);
        });
        it("9. returns 409 conflict when idempotency key is reused with different payload", async () => {
            const idempotencyKey = "key-create-conflict";
            await fetch(`${baseUrl}/api/v1/escrows`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${buyerToken}`,
                    "Idempotency-Key": idempotencyKey,
                },
                body: JSON.stringify({ seller_id: sellerId, amount: "100.00" }),
            });
            const resConflict = await fetch(`${baseUrl}/api/v1/escrows`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${buyerToken}`,
                    "Idempotency-Key": idempotencyKey,
                },
                body: JSON.stringify({ seller_id: sellerId, amount: "200.00" }),
            });
            expect(resConflict.status).toBe(409);
            const data = await resConflict.json();
            expect(data.error).toBe("IDEMPOTENCY_CONFLICT");
        });
    });
    describe("GET /api/v1/escrows and GET /api/v1/escrows/:id — Ownership & IDOR Protection", () => {
        let escrowId;
        beforeEach(async () => {
            const escrow = await app.escrowRepo.create({
                external_reference: `REF-${Date.now()}`,
                buyer_id: buyerId,
                seller_id: sellerId,
                amount: "100.00",
                currency: "USD",
                status: EscrowStatus.CREATED,
            });
            escrowId = escrow.id;
        });
        it("10. allows BUYER and SELLER to retrieve escrow by ID", async () => {
            const resBuyer = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}`, {
                headers: { Authorization: `Bearer ${buyerToken}` },
            });
            expect(resBuyer.status).toBe(200);
            const resSeller = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}`, {
                headers: { Authorization: `Bearer ${sellerToken}` },
            });
            expect(resSeller.status).toBe(200);
        });
        it("11. enforces strict IDOR protection: unrelated user C is forbidden from accessing escrow", async () => {
            const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}`, {
                headers: { Authorization: `Bearer ${userCToken}` },
            });
            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.error).toBe("FORBIDDEN");
        });
        it("12. lists operations for authenticated user with pagination support", async () => {
            const res = await fetch(`${baseUrl}/api/v1/escrows?page=1&limit=10`, {
                headers: { Authorization: `Bearer ${buyerToken}` },
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(Array.isArray(data.escrows)).toBe(true);
            expect(data.escrows.length).toBeGreaterThanOrEqual(1);
            expect(data.page).toBe(1);
            expect(data.limit).toBe(10);
        });
    });
    describe("POST /api/v1/escrows/:id/actions — Business Actions & Domain State Machine", () => {
        let escrowId;
        beforeEach(async () => {
            const escrow = await app.escrowRepo.create({
                external_reference: `REF-ACT-${Date.now()}`,
                buyer_id: buyerId,
                seller_id: sellerId,
                amount: "500.00",
                currency: "USD",
                status: EscrowStatus.CREATED,
            });
            escrowId = escrow.id;
        });
        it("13. executes valid transition (BUYER CANCEL) successfully and logs audit trail", async () => {
            const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/actions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${buyerToken}`,
                },
                body: JSON.stringify({
                    action: "CANCEL_ESCROW",
                    reason: "Buyer changed mind",
                }),
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.escrow.status).toBe(EscrowStatus.CANCELLED);
            // Check audit history
            const historyRes = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/history`, {
                headers: { Authorization: `Bearer ${buyerToken}` },
            });
            expect(historyRes.status).toBe(200);
            const historyData = await historyRes.json();
            expect(historyData.history.some((log) => log.action === "CANCEL_ESCROW")).toBe(true);
        });
        it("14. rejects unrecognized/unsupported business action with 400", async () => {
            const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/actions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${buyerToken}`,
                },
                body: JSON.stringify({
                    action: "INVALID_ACTION_NAME",
                }),
            });
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe("BAD_REQUEST");
        });
        it("15. rejects state transition disallowed by state machine (e.g. BUYER_CONFIRM from CREATED) with 409", async () => {
            const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/actions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${buyerToken}`,
                },
                body: JSON.stringify({
                    action: "BUYER_CONFIRM",
                    reason: "Trying illegal skip transition",
                }),
            });
            expect(res.status).toBe(409);
            const data = await res.json();
            expect(data.error).toBe("INVALID_STATE_TRANSITION");
        });
        it("16. rejects unauthorized actor for a valid transition (e.g. SELLER executing PROCEED_TO_PAYMENT) with 403/409", async () => {
            const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/actions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${sellerToken}`,
                },
                body: JSON.stringify({
                    action: "SELLER_ACCEPT",
                }),
            });
            expect(res.status).toBe(409);
        });
        it("17. OPEN_DISPUTE action creates a dispute record in DB and updates status to DISPUTED", async () => {
            // First transition escrow to PAYMENT_RECEIVED via app DB
            await app.escrowRepo.transitionStatus({
                transactionId: escrowId,
                previousState: EscrowStatus.CREATED,
                newState: EscrowStatus.AWAITING_PAYMENT,
                actorId: buyerId,
                actorRole: ActorRole.BUYER,
                timestamp: new Date(),
                reason: "Move to awaiting payment",
            });
            await app.escrowRepo.transitionStatus({
                transactionId: escrowId,
                previousState: EscrowStatus.AWAITING_PAYMENT,
                newState: EscrowStatus.PAYMENT_RECEIVED,
                actorId: adminId,
                actorRole: ActorRole.ADMIN,
                timestamp: new Date(),
                reason: "Simulate system payment received",
            });
            // Now BUYER opens dispute
            const resDispute = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/actions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${buyerToken}`,
                },
                body: JSON.stringify({
                    action: "OPEN_DISPUTE",
                    reason: "Item not as described",
                    description: "Received incorrect model",
                }),
            });
            expect(resDispute.status).toBe(200);
            const data = await resDispute.json();
            expect(data.escrow.status).toBe(EscrowStatus.DISPUTED);
            // Verify dispute record was created
            const disputes = await app.disputeRepo.findByEscrowId(escrowId);
            expect(disputes.length).toBe(1);
            expect(disputes[0].reason).toBe("Item not as described");
        });
        it("18. rejects direct status tampering attempts via PATCH /api/v1/escrows/:id/status with 400", async () => {
            const res = await fetch(`${baseUrl}/api/v1/escrows/${escrowId}/status`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${buyerToken}`,
                },
                body: JSON.stringify({ status: "RELEASED" }),
            });
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.message).toContain("Direct status modification is prohibited");
        });
    });
    describe("Admin Privileges & RBAC Enforcement", () => {
        it("19. ADMIN can list all escrows across users and access any escrow", async () => {
            await app.escrowRepo.create({
                external_reference: `REF-ADMIN-${Date.now()}`,
                buyer_id: buyerId,
                seller_id: sellerId,
                amount: "250.00",
                currency: "USD",
                status: EscrowStatus.CREATED,
            });
            const resList = await fetch(`${baseUrl}/api/v1/escrows`, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            expect(resList.status).toBe(200);
            const data = await resList.json();
            expect(data.escrows.length).toBeGreaterThan(0);
        });
        it("20. API responses never expose password hashes or sensitive internal secrets", async () => {
            await app.escrowRepo.create({
                external_reference: `REF-SEC-${Date.now()}`,
                buyer_id: buyerId,
                seller_id: sellerId,
                amount: "100.00",
                currency: "USD",
                status: EscrowStatus.CREATED,
            });
            const res = await fetch(`${baseUrl}/api/v1/escrows`, {
                headers: { Authorization: `Bearer ${buyerToken}` },
            });
            const bodyText = await res.text();
            expect(bodyText).not.toContain("password_hash");
            expect(bodyText).not.toContain("JWT_SECRET");
        });
    });
});
//# sourceMappingURL=escrow.test.js.map