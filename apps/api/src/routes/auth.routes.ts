import { Router, Request, Response, NextFunction } from "express";
import { AuthService, AuthenticationError } from "@escrow-ecuador/auth";
import { authenticate } from "../middleware/auth.middleware.js";

export function createAuthRoutes(authService: AuthService): Router {
  const router = Router();

  router.post(
    "/register",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { email, password, role, phone } = req.body;

        if (!email || !password || !role) {
          res
            .status(400)
            .json({ error: "Missing required fields: email, password, role" });
          return;
        }

        const result = await authService.register(email, password, role, phone);

        // Exclude password_hash from the response
        const { password_hash, ...userResponse } = result.user;

        res.status(201).json({
          user: userResponse,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        });
      } catch (error) {
        if (error instanceof AuthenticationError) {
          res.status(400).json({ error: error.message });
        } else {
          next(error);
        }
      }
    },
  );

  router.post(
    "/login",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { email, password } = req.body;

        if (!email || !password) {
          res
            .status(400)
            .json({ error: "Missing required fields: email, password" });
          return;
        }

        const result = await authService.login(email, password);

        // Exclude password_hash from the response
        const { password_hash, ...userResponse } = result.user;

        res.status(200).json({
          user: userResponse,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        });
      } catch (error) {
        if (error instanceof AuthenticationError) {
          res.status(401).json({ error: error.message });
        } else {
          next(error);
        }
      }
    },
  );

  router.post(
    "/refresh",
    authenticate,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.user) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }

        const result = await authService.refresh(
          req.user.userId,
          req.user.role,
        );

        res.status(200).json(result);
      } catch (error) {
        if (error instanceof AuthenticationError) {
          res.status(401).json({ error: error.message });
        } else {
          next(error);
        }
      }
    },
  );

  return router;
}
