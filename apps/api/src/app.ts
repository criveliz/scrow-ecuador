import express, { Express } from "express";
import { AuthService } from "@escrow-ecuador/auth";
import {
  UserRepository,
  RefreshTokenRepository,
  DbClient,
} from "@escrow-ecuador/database";
import { createAuthRoutes } from "./routes/auth.routes.js";

export function createApp(db: DbClient): Express {
  const app = express();

  app.use(express.json());

  // Initialize dependencies
  const userRepository = new UserRepository(db);
  const refreshTokenRepository = new RefreshTokenRepository(db);
  const authService = new AuthService(
    userRepository,
    refreshTokenRepository,
    db,
  );

  // Mount routes
  app.use("/api/v1/auth", createAuthRoutes(authService, userRepository));

  return app;
}
