import { IncomingMessage, ServerResponse } from "http";
import { TokenPayload } from "./jwt.js";
export interface AuthenticatedRequest extends IncomingMessage {
    user?: TokenPayload;
}
export declare function parseBearerToken(req: IncomingMessage): string | null;
export declare function authenticateMiddleware(req: AuthenticatedRequest, res: ServerResponse): boolean;
export declare function authorizeMiddleware(req: AuthenticatedRequest, res: ServerResponse, allowedRoles: string[]): boolean;
//# sourceMappingURL=auth.middleware.d.ts.map