import { Request, Response, NextFunction } from "express";
import { verifyToken, hasRole } from "@escrow-ecuador/auth";
import { ActorRole } from "@escrow-ecuador/domain";
import { UserRepository } from "@escrow-ecuador/database";

declare module "express-serve-static-core" {
  interface Request {
    user?: {
      userId: string;
      role: string;
      tokenVersion: number;
    };
  }
}

export function createAuthenticate(userRepository: UserRepository) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
      return;
    }

    const token = authHeader.split(" ")[1];

    try {
      const payload = verifyToken(token);

      const user = await userRepository.findById(payload.userId);

      if (!user) {
        res.status(401).json({ error: "User not found" });
        return;
      }

      if (user.status !== "ACTIVE") {
        res
          .status(401)
          .json({ error: "User account is suspended or inactive" });
        return;
      }

      if (user.token_version !== payload.tokenVersion) {
        res
          .status(401)
          .json({ error: "Token version is stale. Please login again." });
        return;
      }

      req.user = payload;
      next();
    } catch (error) {
      res.status(401).json({ error: "Invalid token" });
    }
  };
}

export function requireRoles(roles: ActorRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!hasRole(req.user.role, roles)) {
      res.status(403).json({ error: "Forbidden: insufficient permissions" });
      return;
    }

    next();
  };
}
