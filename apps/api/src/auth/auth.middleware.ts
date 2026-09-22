import { IncomingMessage, ServerResponse } from "http";
import { TokenPayload, verifyToken } from "./jwt.js";
import { hasAnyRole, requiresMfa } from "./rbac.js";

export interface AuthenticatedRequest extends IncomingMessage {
  user?: TokenPayload;
}

export function parseBearerToken(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;

  return parts[1];
}

export function authenticateMiddleware(req: AuthenticatedRequest, res: ServerResponse): boolean {
  const token = parseBearerToken(req);
  if (!token) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "UNAUTHORIZED", message: "Missing or invalid Authorization header" }));
    return false;
  }

  try {
    const payload = verifyToken(token);
    if (payload.type !== "ACCESS") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "UNAUTHORIZED", message: "Invalid token type" }));
      return false;
    }

    req.user = payload;
    return true;
  } catch (err: any) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "UNAUTHORIZED", message: err.message || "Invalid or expired token" }));
    return false;
  }
}

export function authorizeMiddleware(
  req: AuthenticatedRequest,
  res: ServerResponse,
  allowedRoles: string[]
): boolean {
  if (!req.user) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "UNAUTHORIZED", message: "User not authenticated" }));
    return false;
  }

  if (!hasAnyRole(req.user.role, allowedRoles)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "FORBIDDEN", message: "Insufficient permissions" }));
    return false;
  }

  if (requiresMfa(req.user.role) && !req.user.mfaVerified) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "MFA_REQUIRED", message: "MFA verification required for this role" }));
    return false;
  }

  return true;
}
