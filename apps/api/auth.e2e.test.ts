import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "./src/app.js";
import {
  DbClient,
  PgMemDbClient,
  runMigrations,
} from "@escrow-ecuador/database";
import fs from "fs";
import path from "path";
import { ActorRole } from "@escrow-ecuador/domain";
import { Express } from "express";

describe("Auth API E2E", () => {
  let db: DbClient;
  let app: Express;

  beforeEach(async () => {
    db = new PgMemDbClient();
    await runMigrations(db);
    const schemaSql = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../packages/database/schema/002_auth_hardening.sql",
      ),
      "utf8",
    );
    await db.query(schemaSql);
    app = createApp(db);
  });

  describe("POST /api/v1/auth/register", () => {
    it("should register a user and return tokens", async () => {
      const response = await request(app).post("/api/v1/auth/register").send({
        email: "e2e@example.com",
        password: "securepassword",
        role: ActorRole.BUYER,
      });

      expect(response.status).toBe(201);
      expect(response.body.user).toBeDefined();
      expect(response.body.user.email).toBe("e2e@example.com");
      expect(response.body.user.password_hash).toBeUndefined(); // Should not leak password hash
      expect(response.body.accessToken).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
    });

    it("should reject duplicate registration", async () => {
      await request(app).post("/api/v1/auth/register").send({
        email: "duplicate@example.com",
        password: "securepassword",
        role: ActorRole.BUYER,
      });

      const response = await request(app).post("/api/v1/auth/register").send({
        email: "duplicate@example.com",
        password: "securepassword",
        role: ActorRole.BUYER,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("User with this email already exists");
    });
  });

  describe("POST /api/v1/auth/login", () => {
    beforeEach(async () => {
      await request(app).post("/api/v1/auth/register").send({
        email: "login@example.com",
        password: "securepassword",
        role: ActorRole.SELLER,
      });
    });

    it("should login a user with correct credentials", async () => {
      const response = await request(app).post("/api/v1/auth/login").send({
        email: "login@example.com",
        password: "securepassword",
      });

      expect(response.status).toBe(200);
      expect(response.body.user).toBeDefined();
      expect(response.body.user.email).toBe("login@example.com");
      expect(response.body.accessToken).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
    });

    it("should reject login with wrong password", async () => {
      const response = await request(app).post("/api/v1/auth/login").send({
        email: "login@example.com",
        password: "wrongpassword",
      });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Invalid email or password");
    });
  });

  describe("POST /api/v1/auth/refresh", () => {
    let accessToken: string;
    let refreshToken: string;

    beforeEach(async () => {
      const res = await request(app).post("/api/v1/auth/register").send({
        email: "refresh@example.com",
        password: "securepassword",
        role: ActorRole.BUYER,
      });

      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });

    it("should refresh tokens using a valid refresh token in the body", async () => {
      // Need a small timeout to avoid token being issued at the exact same millisecond
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const response = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken });

      expect(response.status).toBe(200);
      expect(response.body.accessToken).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
    });

    it("should fail to refresh without refresh token in body", async () => {
      const response = await request(app).post("/api/v1/auth/refresh").send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Missing required field: refreshToken");
    });

    it("should fail to refresh with invalid token", async () => {
      const response = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: "invalid.token.here" });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Invalid refresh token");
    });
  });

  describe("RBAC Middleware", () => {
    it("should export requireRoles middleware correctly (unit test via route)", async () => {
      // Mount a test route to verify RBAC
      const { requireRoles, createAuthenticate } =
        await import("./src/middleware/auth.middleware.js");
      const { UserRepository } = await import("@escrow-ecuador/database");
      const authenticate = createAuthenticate(new UserRepository(db));
      app.get(
        "/api/v1/test-admin-only",
        authenticate,
        requireRoles([ActorRole.ADMIN]),
        (req, res) => {
          res.status(200).json({ ok: true });
        },
      );

      const res = await request(app).post("/api/v1/auth/register").send({
        email: "buyer@example.com",
        password: "pw",
        role: ActorRole.BUYER,
      });

      const buyerToken = res.body.accessToken;

      const testRes = await request(app)
        .get("/api/v1/test-admin-only")
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(testRes.status).toBe(403);
      expect(testRes.body.error).toBe("Forbidden: insufficient permissions");
    });
  });
});
