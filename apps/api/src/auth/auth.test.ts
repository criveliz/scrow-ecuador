import { ActorRole } from "@escrow-ecuador/domain";
import { PgMemDbClient, runMigrations } from "@escrow-ecuador/database";
import { describe, expect, it, beforeEach } from "vitest";
import { hashPassword, verifyPassword } from "./crypto.js";
import { generateToken, verifyToken } from "./jwt.js";
import { createApiServer } from "../index.js";
import { AuthService } from "./auth.service.js";
import { RefreshTokenRepository, UserRepository } from "@escrow-ecuador/database";
import { hasAnyRole, hasRole, isPrivilegedRole, requiresMfa, validateRole } from "./rbac.js";

describe("Task 4 — Authentication & RBAC Unit and Integration Tests", () => {
  let db: PgMemDbClient;
  let userRepo: UserRepository;
  let refreshTokenRepo: RefreshTokenRepository;
  let authService: AuthService;

  beforeEach(async () => {
    db = new PgMemDbClient();
    await runMigrations(db);
    userRepo = new UserRepository(db);
    refreshTokenRepo = new RefreshTokenRepository(db);
    authService = new AuthService(userRepo, refreshTokenRepo);
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

  describe("JWT Token Handling", () => {
    it("generates and verifies valid access tokens", () => {
      const token = generateToken(
        { userId: "u-123", email: "test@example.com", role: ActorRole.BUYER, type: "ACCESS" },
        300,
        "test-secret"
      );

      const payload = verifyToken(token, "test-secret");
      expect(payload.userId).toBe("u-123");
      expect(payload.email).toBe("test@example.com");
      expect(payload.role).toBe(ActorRole.BUYER);
      expect(payload.type).toBe("ACCESS");
    });

    it("fails verification on invalid signature or tampered token", () => {
      const token = generateToken(
        { userId: "u-123", email: "test@example.com", role: ActorRole.BUYER, type: "ACCESS" },
        300,
        "secret-1"
      );

      expect(() => verifyToken(token, "wrong-secret")).toThrow("Invalid token signature");
    });
  });

  describe("RBAC Helper Logic", () => {
    it("identifies privileged roles and MFA requirements", () => {
      expect(isPrivilegedRole(ActorRole.ADMIN)).toBe(true);
      expect(isPrivilegedRole("SUPER_ADMIN")).toBe(true);
      expect(isPrivilegedRole(ActorRole.BUYER)).toBe(false);

      expect(requiresMfa(ActorRole.ADMIN)).toBe(true);
      expect(requiresMfa("SUPER_ADMIN")).toBe(true);
      expect(requiresMfa(ActorRole.SELLER)).toBe(false);
    });

    it("validates roles and checks role hierarchy/permissions", () => {
      expect(validateRole("buyer")).toBe(ActorRole.BUYER);
      expect(validateRole("SUPER_ADMIN")).toBe("SUPER_ADMIN");
      expect(() => validateRole("invalid_role")).toThrow("Invalid role");

      expect(hasRole(ActorRole.BUYER, ActorRole.BUYER)).toBe(true);
      expect(hasRole(ActorRole.BUYER, ActorRole.SELLER)).toBe(false);
      expect(hasRole("SUPER_ADMIN", ActorRole.ADMIN)).toBe(true); // Super Admin bypasses

      expect(hasAnyRole(ActorRole.SELLER, [ActorRole.BUYER, ActorRole.SELLER])).toBe(true);
      expect(hasAnyRole(ActorRole.SUPPORT, [ActorRole.BUYER, ActorRole.SELLER])).toBe(false);
    });
  });

  describe("AuthService Registration & Login", () => {
    it("registers new BUYER and returns access + refresh tokens", async () => {
      const res = await authService.register({
        email: "buyer@example.com",
        password: "securePassword123",
        role: "BUYER",
      });

      expect(res.accessToken).toBeDefined();
      expect(res.refreshToken).toBeDefined();
      expect(res.user.email).toBe("buyer@example.com");
      expect(res.user.role).toBe(ActorRole.BUYER);
    });

    it("requires MFA code when registering or logging in as ADMIN", async () => {
      await expect(
        authService.register({
          email: "admin@example.com",
          password: "adminPassword123",
          role: "ADMIN",
        })
      ).rejects.toThrow("MFA verification code is required for privileged roles");

      const adminAuth = await authService.register({
        email: "admin@example.com",
        password: "adminPassword123",
        role: "ADMIN",
        mfaCode: "123456",
      });

      expect(adminAuth.user.role).toBe(ActorRole.ADMIN);

      await expect(
        authService.login({
          email: "admin@example.com",
          password: "adminPassword123",
        })
      ).rejects.toThrow("MFA code required for privileged role");

      const loginRes = await authService.login({
        email: "admin@example.com",
        password: "adminPassword123",
        mfaCode: "123456",
      });

      expect(loginRes.accessToken).toBeDefined();
    });

    it("prevents registration with duplicate email", async () => {
      await authService.register({ email: "dup@example.com", password: "password123" });
      await expect(
        authService.register({ email: "dup@example.com", password: "password123" })
      ).rejects.toThrow("User with this email already exists");
    });

    it("rejects invalid login credentials", async () => {
      await authService.register({ email: "user@example.com", password: "password123" });
      await expect(
        authService.login({ email: "user@example.com", password: "wrongpassword" })
      ).rejects.toThrow("Invalid email or password");
    });
  });

  describe("Token Rotation & Token Reuse Detection", () => {
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
      await expect(
        authService.refresh({ refreshToken: oldRefreshToken })
      ).rejects.toThrow("Refresh token reuse detected!");

      // Subsequent attempt with new token (refresh1) also fails because whole family was revoked
      await expect(
        authService.refresh({ refreshToken: refresh1.refreshToken })
      ).rejects.toThrow();
    });
  });
});
