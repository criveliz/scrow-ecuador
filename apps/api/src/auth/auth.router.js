import { authenticateMiddleware } from "./auth.middleware.js";
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
                reject(new Error("Invalid JSON body"));
            }
        });
        req.on("error", (err) => reject(err));
    });
}
function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
}
export function handleAuthRoutes(req, res, authService, urlPath) {
    const method = req.method?.toUpperCase();
    if (method === "POST" && urlPath === "/api/v1/auth/register") {
        parseJsonBody(req)
            .then((body) => authService.register(body))
            .then((result) => sendJson(res, 201, result))
            .catch((err) => sendJson(res, 400, { error: "BAD_REQUEST", message: err.message }));
        return true;
    }
    if (method === "POST" && urlPath === "/api/v1/auth/login") {
        parseJsonBody(req)
            .then((body) => authService.login(body))
            .then((result) => sendJson(res, 200, result))
            .catch((err) => sendJson(res, 401, { error: "UNAUTHORIZED", message: err.message }));
        return true;
    }
    if (method === "POST" && urlPath === "/api/v1/auth/refresh") {
        parseJsonBody(req)
            .then((body) => authService.refresh(body))
            .then((result) => sendJson(res, 200, result))
            .catch((err) => sendJson(res, 401, { error: "UNAUTHORIZED", message: err.message }));
        return true;
    }
    if (method === "GET" && urlPath === "/api/v1/users/me") {
        if (authenticateMiddleware(req, res)) {
            authService
                .getMe(req.user.userId)
                .then((user) => sendJson(res, 200, { user }))
                .catch((err) => sendJson(res, 404, { error: "NOT_FOUND", message: err.message }));
        }
        return true;
    }
    return false;
}
//# sourceMappingURL=auth.router.js.map