import http from "node:http";
import { ReconciliationService } from "@escrow-ecuador/database";
import { KushkiWebhookVerifier } from "@escrow-ecuador/providers";
export class WebhookServer {
    server;
    verifier;
    reconService;
    constructor(db, webhookSecret) {
        this.verifier = new KushkiWebhookVerifier({ webhookSecret });
        this.reconService = new ReconciliationService(db);
        this.server = http.createServer(async (req, res) => {
            // 1. Match POST /api/v1/webhooks/kushki
            const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
            if (req.method === "POST" && url.pathname === "/api/v1/webhooks/kushki") {
                await this.handleKushkiWebhook(req, res);
            }
            else {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Not Found" }));
            }
        });
    }
    async handleKushkiWebhook(req, res) {
        try {
            // Collect raw request body
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
            }
            const rawBody = Buffer.concat(chunks).toString("utf8");
            const signature = req.headers["x-kushki-signature"] || req.headers["kushki-signature"];
            const timestampHeader = req.headers["x-kushki-timestamp"] || req.headers["kushki-timestamp"];
            // Verify signature and replay timestamp window BEFORE parsing JSON
            const verification = this.verifier.verifySignatureAndTimestamp({
                rawBody,
                signature,
                timestampHeader,
            });
            if (!verification.valid) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    status: "REJECTED",
                    message: verification.reason || "Invalid webhook signature",
                }));
                return;
            }
            // Parse payload and extract Kushki event fields
            const payload = JSON.parse(rawBody);
            const event = this.verifier.extractEvent(payload);
            // Process via ReconciliationService safely & idempotently
            const result = await this.reconService.processKushkiWebhook(event);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                status: "ACCEPTED",
                reconciliationStatus: result.reconciliationStatus,
                isDuplicate: result.isDuplicate,
            }));
        }
        catch (err) {
            // Never expose SQL stack traces or secrets to webhook sender
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                status: "ERROR",
                message: "Internal server error processing webhook",
            }));
        }
    }
    getHttpServer() {
        return this.server;
    }
    listen(port) {
        return new Promise((resolve) => {
            this.server.listen(port, () => resolve());
        });
    }
    close() {
        return new Promise((resolve, reject) => {
            this.server.close((err) => (err ? reject(err) : resolve()));
        });
    }
}
//# sourceMappingURL=webhook-server.js.map