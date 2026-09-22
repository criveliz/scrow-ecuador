import { IncomingMessage, ServerResponse } from "http";
import { AuthenticatedRequest, authenticateMiddleware } from "../auth/auth.middleware.js";
import { PaymentService, PaymentServiceError } from "./payment.service.js";

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
        reject(new PaymentServiceError(400, "BAD_REQUEST", "Invalid JSON body"));
      }
    });
    req.on("error", (err) => reject(err));
  });
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function handlePaymentRoutes(
  req: AuthenticatedRequest,
  res: ServerResponse,
  paymentService: PaymentService,
  urlPath: string
): boolean {
  const method = req.method?.toUpperCase();

  // Route 1: POST /api/v1/escrows/:id/payment
  const initiateMatch = urlPath.match(/^\/api\/v1\/escrows\/([^/]+)\/payment$/i);
  if (method === "POST" && initiateMatch) {
    if (!authenticateMiddleware(req, res)) return true;

    const escrowId = initiateMatch[1];
    parseJsonBody<Record<string, any>>(req)
      .then((body) => {
        const idempotencyKey = getHeader(req, "idempotency-key") || getHeader(req, "x-idempotency-key");
        const ipAddress = getHeader(req, "x-forwarded-for") || req.socket.remoteAddress;
        const userAgent = getHeader(req, "user-agent");

        return paymentService.initiatePayment(req.user!, escrowId, body, idempotencyKey, ipAddress, userAgent);
      })
      .then((result) => sendJson(res, result.status, result.body))
      .catch((err: Error) => {
        if (err instanceof PaymentServiceError) {
          sendJson(res, err.statusCode, { error: err.errorCode, message: err.message });
        } else {
          sendJson(res, 500, { error: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" });
        }
      });
    return true;
  }

  // Route 2: GET /api/v1/payments/:id
  const getPaymentMatch = urlPath.match(/^\/api\/v1\/payments\/([^/]+)$/i);
  if (method === "GET" && getPaymentMatch) {
    if (!authenticateMiddleware(req, res)) return true;

    const paymentId = getPaymentMatch[1];
    paymentService
      .getPaymentById(req.user!, paymentId)
      .then((payment) => sendJson(res, 200, { payment }))
      .catch((err: Error) => {
        if (err instanceof PaymentServiceError) {
          sendJson(res, err.statusCode, { error: err.errorCode, message: err.message });
        } else {
          sendJson(res, 500, { error: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" });
        }
      });
    return true;
  }

  return false;
}
