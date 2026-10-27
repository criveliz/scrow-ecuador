import { describe, expect, it, beforeEach } from "vitest";
import { hashPassword, verifyPassword } from "./crypto.js";
import { generateToken, verifyToken, generateRefreshToken } from "./jwt.js";
import { assertRole, hasRole, AuthorizationError } from "./rbac.js";
import { ActorRole } from "@escrow-ecuador/domain";
import { AuthService, AuthenticationError } from "./auth.service.js";
import {
  DbClient,
  UserRepository,
  runMigrations,
  PgMemDbClient,
} from "@escrow-ecuador/database";

describe("Auth Module", () => {
  describe("Crypto", () => {
    it("should hash and verify passwords correctly", async () => {
      const password = "mySecretPassword123";
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toEqual(password);
      expect(hash.includes(":")).toBe(true);

      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);

      const isInvalid = await verifyPassword("wrongPassword", hash);
      expect(isInvalid).toBe(false);
    });
  });

  describe("JWT", () => {
    it("should generate and verify tokens", () => {
      const payload = { userId: "user-123", role: ActorRole.BUYER };
      const token = generateToken(payload);

      expect(token).toBeDefined();

      const verified = verifyToken(token);
      expect(verified.userId).toBe(payload.userId);
      expect(verified.role).toBe(payload.role);
    });

    it("should generate refresh tokens", () => {
      const payload = { userId: "user-123", role: ActorRole.BUYER };
      const token = generateRefreshToken(payload);

      expect(token).toBeDefined();

      const verified = verifyToken(token);
      expect(verified.userId).toBe(payload.userId);
      expect(verified.role).toBe(payload.role);
    });
  });

  describe("RBAC", () => {
    it("should allow roles in the allowed list", () => {
      expect(
        hasRole(ActorRole.ADMIN, [ActorRole.ADMIN, ActorRole.SUPPORT]),
      ).toBe(true);
      expect(
        hasRole(ActorRole.BUYER, [ActorRole.BUYER, ActorRole.SELLER]),
      ).toBe(true);
    });

    it("should deny roles not in the allowed list", () => {
      expect(
        hasRole(ActorRole.BUYER, [ActorRole.ADMIN, ActorRole.SUPPORT]),
      ).toBe(false);
    });

    it("should assert role and throw if invalid", () => {
      expect(() =>
        assertRole(ActorRole.ADMIN, [ActorRole.ADMIN]),
      ).not.toThrow();
      expect(() => assertRole(ActorRole.BUYER, [ActorRole.ADMIN])).toThrow(
        AuthorizationError,
      );
    });
  });

  describe("AuthService Integration", () => {
    let db: DbClient;
    let userRepository: UserRepository;
    let authService: AuthService;

    beforeEach(async () => {
      db = new PgMemDbClient();
      await runMigrations(db);

      userRepository = new UserRepository(db);
      authService = new AuthService(userRepository);
    });

    it("should register a new user successfully", async () => {
      const result = await authService.register(
        "test@example.com",
        "password123",
        ActorRole.BUYER,
        "+1234567890",
      );

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe("test@example.com");
      expect(result.user.role).toBe(ActorRole.BUYER);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it("should prevent duplicate registration", async () => {
      await authService.register(
        "duplicate@example.com",
        "password123",
        ActorRole.BUYER,
      );

      await expect(
        authService.register(
          "duplicate@example.com",
          "password456",
          ActorRole.SELLER,
        ),
      ).rejects.toThrow(AuthenticationError);
    });

    it("should login successfully with correct credentials", async () => {
      await authService.register(
        "login@example.com",
        "mypassword",
        ActorRole.SELLER,
      );

      const result = await authService.login("login@example.com", "mypassword");

      expect(result.user.email).toBe("login@example.com");
      expect(result.accessToken).toBeDefined();
    });

    it("should reject login with wrong password", async () => {
      await authService.register(
        "wrongpass@example.com",
        "mypassword",
        ActorRole.SELLER,
      );

      await expect(
        authService.login("wrongpass@example.com", "wrongpassword"),
      ).rejects.toThrow(AuthenticationError);
    });

    it("should reject login for non-existent user", async () => {
      await expect(
        authService.login("nonexistent@example.com", "mypassword"),
      ).rejects.toThrow(AuthenticationError);
    });

    it("should refresh tokens successfully", async () => {
      const { user, accessToken: originalAccessToken } =
        await authService.register(
          "refresh@example.com",
          "mypassword",
          ActorRole.BUYER,
        );

      // Wait 1 second to ensure JWT "iat" (issued at) claim is different
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const result = await authService.refresh(user.id, user.role);

      expect(result.accessToken).toBeDefined();
      expect(result.accessToken).not.toEqual(originalAccessToken);
      expect(result.refreshToken).toBeDefined();
    });

    it("should throw error if user not found during refresh", async () => {
      await expect(
        authService.refresh(
          "00000000-0000-0000-0000-000000000000",
          ActorRole.BUYER,
        ),
      ).rejects.toThrow(AuthenticationError);
    });
  });
});
