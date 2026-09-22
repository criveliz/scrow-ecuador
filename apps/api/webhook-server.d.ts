import http from "node:http";
import { DbClient } from "@escrow-ecuador/database";
export declare class WebhookServer {
    private server;
    private verifier;
    private reconService;
    constructor(db: DbClient, webhookSecret?: string);
    private handleKushkiWebhook;
    getHttpServer(): http.Server;
    listen(port: number): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=webhook-server.d.ts.map