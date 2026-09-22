import { ActorRole } from "@escrow-ecuador/domain";
import { PgMemDbClient, runMigrations } from "@escrow-ecuador/database";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { hashPassword, verifyPassword } from "./crypto.js";
import { generateToken, verifyToken } from "./jwt.js";
import { createApiServer } from "../index.js";
import { AuthService } from "./auth.service.js";
import { RefreshTokenRepository, UserRepository } from "@escrow-ecuador/database";
describe("Task 4 — Authentication & RBAC Security Remediation Tests", () => {
    let db;
    let userRepo;
    let refreshTokenRepo;
    let authService;
    const originalEnv = process.env;
    beforeEach(async () => {
        process.env = { ...originalEnv };
        db = new PgMemDbClient();
        await runMigrations(db);
        userRepo = new UserRepository(db);
        refreshTokenRepo = new RefreshTokenRepository(db);
        authService = new AuthService(userRepo, refreshTokenRepo);
    });
    afterEach(() => {
        process.env = originalEnv;
    });
    describe("Password Hashing & Verification (Crypto)", () => {
        it("hashes password with unique salt and verifies correctly", async () => {
            const password = "StrongPassword123!";
            const hash = await hashPassword(password);
            expect(hash).toContain(":");
            expect(await verifyPassword(password, hash)).toBe(true);
            expect(await verifyPassword("WrongPassword", hash)).toBe(false);
        });
        it("rejects passwords under 8 characters", async () => {
            await expect(hashPassword("short")).rejects.toThrow("Password must be at least 8 characters long");
        });
    });
    describe("JWT Token Handling & Production Security", () => {
        it("generates and verifies valid access tokens", () => {
            const token = generateToken({ userId: "u-123", email: "test@example.com", role: ActorRole.BUYER, type: "ACCESS" }, 300, "test-secret");
            const payload = verifyToken(token, "test-secret");
            expect(payload.userId).toBe("u-123");
            expect(payload.email).toBe("test@example.com");
            expect(payload.role).toBe(ActorRole.BUYER);
            expect(payload.type).toBe("ACCESS");
        });
        it("fails verification on invalid signature or tampered token", () => {
            const token = generateToken({ userId: "u-123", email: "test@example.com", role: ActorRole.BUYER, type: "ACCESS" }, 300, "secret-1");
            expect(() => verifyToken(token, "wrong-secret")).toThrow("Invalid token signature");
        });
        it("requires JWT_SECRET in production and throws fatal error if missing", () => {
            process.env.NODE_ENV = "production";
            delete process.env.JWT_SECRET;
            expect(() => generateToken({ userId: "u-prod", email: "prod@example.com", role: ActorRole.BUYER, type: "ACCESS" }, 300)).toThrow("FATAL: JWT_SECRET environment variable is strictly required in production!");
            expect(() => createApiServer()).toThrow("FATAL: JWT_SECRET environment variable is strictly required in production!");
        });
    });
    describe("Public Registration Role Security", () => {
        it("allows normal registration for BUYER and SELLER roles", async () => {
            const buyerRes = await authService.register({
                email: "buyer_normal@example.com",
                password: "securePassword123",
                role: "BUYER",
            });
            expect(buyerRes.user.role).toBe(ActorRole.BUYER);
            const sellerRes = await authService.register({
                email: "seller_normal@example.com",
                password: "securePassword123",
                role: "SELLER",
            });
            expect(sellerRes.user.role).toBe(ActorRole.SELLER);
        });
        it("overrides public registration attempts for ADMIN, SUPER_ADMIN, and SUPPORT to BUYER", async () => {
            const adminAttempt = await authService.register({
                email: "attacker_admin@example.com",
                password: "securePassword123",
                role: "ADMIN",
                mfaCode: "123456",
            });
            expect(adminAttempt.user.role).toBe(ActorRole.BUYER);
            const superAdminAttempt = await authService.register({
                email: "attacker_superadmin@example.com",
                password: "securePassword123",
                role: "SUPER_ADMIN",
                mfaCode: "123456",
            });
            expect(superAdminAttempt.user.role).toBe(ActorRole.BUYER);
            const supportAttempt = await authService.register({
                email: "attacker_support@example.com",
                password: "securePassword123",
                role: "SUPPORT",
            });
            expect(supportAttempt.user.role).toBe(ActorRole.BUYER);
        });
    });
    describe("MFA Enforcement in Production", () => {
        it("rejects static MFA code 123456 when NODE_ENV === 'production'", async () => {
            // Manually create an ADMIN user in database (e.g. via DB seed/bootstrap)
            const adminUser = await userRepo.create({
                email: "real_admin@example.com",
                password_hash: await hashPassword("adminPass123!"),
                role: ActorRole.ADMIN,
                status: "ACTIVE",
            });
            process.env.NODE_ENV = "production";
            await expect(authService.login({
                email: adminUser.email,
                password: "adminPass123!",
                mfaCode: "123456",
            })).rejects.toThrow("MFA implementation for production requires valid TOTP token provider");
        });
    });
    describe("Token Rotation & Reuse Detection", () => {
        it("rotates refresh token successfully", async () => {
            const initialAuth = await authService.register({
                email: "rot@example.com",
                password: "password123",
            });
            const refreshRes = await authService.refresh({ refreshToken: initialAuth.refreshToken });
            expect(refreshRes.accessToken).toBeDefined();
            expect(refreshRes.refreshToken).toBeDefined();
            expect(refreshRes.refreshToken).not.toBe(initialAuth.refreshToken);
        });
        it("detects refresh token reuse and revokes token family", async () => {
            const initialAuth = await authService.register({
                email: "reuse@example.com",
                password: "password123",
            });
            const oldRefreshToken = initialAuth.refreshToken;
            // First refresh succeeds and revokes oldRefreshToken
            const refresh1 = await authService.refresh({ refreshToken: oldRefreshToken });
            // Attempting to reuse oldRefreshToken triggers reuse detection!
            await expect(authService.refresh({ refreshToken: oldRefreshToken })).rejects.toThrow("Refresh token reuse detected!");
            // Subsequent attempt with new token (refresh1) also fails because whole family was revoked
            await expect(authService.refresh({ refreshToken: refresh1.refreshToken })).rejects.toThrow();
        });
    });
});
//# sourceMappingURL=auth.test.js.map