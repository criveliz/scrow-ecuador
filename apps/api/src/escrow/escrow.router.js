import { authenticateMiddleware } from "../auth/auth.middleware.js";
import { EscrowServiceError } from "./escrow.service.js";
function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk.toString();
        });
        req.on("end", () => {
            try {
                if (!body.trim()) {
                    resolve({});
                }
                else {
                    resolve(JSON.parse(body));
                }
            }
            catch (e) {
                reject(new EscrowServiceError(400, "BAD_REQUEST", "Invalid JSON body"));
            }
        });
        req.on("error", (err) => reject(err));
    });
}
function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
}
function getHeader(req, name) {
    const value = req.headers[name.toLowerCase()];
    if (Array.isArray(value))
        return value[0];
    return value;
}
export function handleEscrowRoutes(req, res, escrowService, urlPath) {
    const method = req.method?.toUpperCase();
    // Reject explicit direct status update attempts (PATCH /escrows/:id/status or PUT /escrows/:id/status or PATCH /escrows/:id)
    if ((method === "PATCH" || method === "PUT") && (urlPath.includes("/escrows/") || urlPath.includes("/status"))) {
        sendJson(res, 400, {
            error: "BAD_REQUEST",
            message: "Direct status modification is prohibited. Use business actions via POST /api/v1/escrows/:id/actions",
        });
        return true;
    }
    // Route 1: POST /api/v1/escrows
    if (method === "POST" && urlPath === "/api/v1/escrows") {
        if (!authenticateMiddleware(req, res))
            return true;
        parseJsonBody(req)
            .then((body) => {
            const idempotencyKey = getHeader(req, "idempotency-key") || getHeader(req, "x-idempotency-key");
            const ipAddress = getHeader(req, "x-forwarded-for") || req.socket.remoteAddress;
            const userAgent = getHeader(req, "user-agent");
            return escrowService.createEscrow(req.user, body, idempotencyKey, ipAddress, userAgent);
        })
            .then((result) => sendJson(res, result.status, result.body))
            .catch((err) => {
            if (err instanceof EscrowServiceError) {
                sendJson(res, err.statusCode, { error: err.errorCode, message: err.message });
            }
            else {
                sendJson(res, 500, { error: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" });
            }
        });
        return true;
    }
    // Route 2: GET /api/v1/escrows
    if (method === "GET" && urlPath === "/api/v1/escrows") {
        if (!authenticateMiddleware(req, res))
            return true;
        const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        const page = parsedUrl.searchParams.get("page") || undefined;
        const limit = parsedUrl.searchParams.get("limit") || undefined;
        escrowService
            .listEscrows(req.user, { page, limit })
            .then((result) => sendJson(res, 200, result))
            .catch((err) => {
            if (err instanceof EscrowServiceError) {
                sendJson(res, err.statusCode, { error: err.errorCode, message: err.message });
            }
            else {
                sendJson(res, 500, { error: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" });
            }
        });
        return true;
    }
    // Route 3: POST /api/v1/escrows/:id/actions
    const actionMatch = urlPath.match(/^\/api\/v1\/escrows\/([a-f0-9-]+)\/actions$/i);
    if (method === "POST" && actionMatch) {
        if (!authenticateMiddleware(req, res))
            return true;
        const escrowId = actionMatch[1];
        parseJsonBody(req)
            .then((body) => {
            const idempotencyKey = getHeader(req, "idempotency-key") || getHeader(req, "x-idempotency-key");
            const ipAddress = getHeader(req, "x-forwarded-for") || req.socket.remoteAddress;
            const userAgent = getHeader(req, "user-agent");
            return escrowService.executeAction(req.user, escrowId, body, idempotencyKey, ipAddress, userAgent);
        })
            .then((result) => sendJson(res, result.status, result.body))
            .catch((err) => {
            if (err instanceof EscrowServiceError) {
                sendJson(res, err.statusCode, { error: err.errorCode, message: err.message });
            }
            else {
                sendJson(res, 500, { error: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" });
            }
        });
        return true;
    }
    // Route 4: GET /api/v1/escrows/:id/history
    const historyMatch = urlPath.match(/^\/api\/v1\/escrows\/([a-f0-9-]+)\/history$/i);
    if (method === "GET" && historyMatch) {
        if (!authenticateMiddleware(req, res))
            return true;
        const escrowId = historyMatch[1];
        escrowService
            .getEscrowHistory(req.user, escrowId)
            .then((result) => sendJson(res, 200, result))
            .catch((err) => {
            if (err instanceof EscrowServiceError) {
                sendJson(res, err.statusCode, { error: err.errorCode, message: err.message });
            }
            else {
                sendJson(res, 500, { error: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" });
            }
        });
        return true;
    }
    // Route 5: GET /api/v1/escrows/:id
    const getMatch = urlPath.match(/^\/api\/v1\/escrows\/([a-f0-9-]+)$/i);
    if (method === "GET" && getMatch) {
        if (!authenticateMiddleware(req, res))
            return true;
        const escrowId = getMatch[1];
        escrowService
            .getEscrowById(req.user, escrowId)
            .then((escrow) => sendJson(res, 200, { escrow }))
            .catch((err) => {
            if (err instanceof EscrowServiceError) {
                sendJson(res, err.statusCode, { error: err.errorCode, message: err.message });
            }
            else {
                sendJson(res, 500, { error: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" });
            }
        });
        return true;
    }
    return false;
}
//# sourceMappingURL=escrow.router.js.map