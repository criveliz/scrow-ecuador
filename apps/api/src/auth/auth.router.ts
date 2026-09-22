import { IncomingMessage, ServerResponse } from "http";
import { AuthService } from "./auth.service.js";
import { AuthenticatedRequest, authenticateMiddleware } from "./auth.middleware.js";

function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        if (!body.trim()) {
          resolve({} as T);
        } else {
          resolve(JSON.parse(body) as T);
        }
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", (err) => reject(err));
  });
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function handleAuthRoutes(
  req: AuthenticatedRequest,
  res: ServerResponse,
  authService: AuthService,
  urlPath: string
): boolean {
  const method = req.method?.toUpperCase();

  if (method === "POST" && urlPath === "/api/v1/auth/register") {
    parseJsonBody(req)
      .then((body: any) => authService.register(body))
      .then((result) => sendJson(res, 201, result))
      .catch((err: Error) => sendJson(res, 400, { error: "BAD_REQUEST", message: err.message }));
    return true;
  }

  if (method === "POST" && urlPath === "/api/v1/auth/login") {
    parseJsonBody(req)
      .then((body: any) => authService.login(body))
      .then((result) => sendJson(res, 200, result))
      .catch((err: Error) => sendJson(res, 401, { error: "UNAUTHORIZED", message: err.message }));
    return true;
  }

  if (method === "POST" && urlPath === "/api/v1/auth/refresh") {
    parseJsonBody(req)
      .then((body: any) => authService.refresh(body))
      .then((result) => sendJson(res, 200, result))
      .catch((err: Error) => sendJson(res, 401, { error: "UNAUTHORIZED", message: err.message }));
    return true;
  }

  if (method === "GET" && urlPath === "/api/v1/users/me") {
    if (authenticateMiddleware(req, res)) {
      authService
        .getMe(req.user!.userId)
        .then((user) => sendJson(res, 200, { user }))
        .catch((err: Error) => sendJson(res, 404, { error: "NOT_FOUND", message: err.message }));
    }
    return true;
  }

  return false;
}
