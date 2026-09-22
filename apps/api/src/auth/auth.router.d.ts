import { ServerResponse } from "http";
import { AuthService } from "./auth.service.js";
import { AuthenticatedRequest } from "./auth.middleware.js";
export declare function handleAuthRoutes(req: AuthenticatedRequest, res: ServerResponse, authService: AuthService, urlPath: string): boolean;
//# sourceMappingURL=auth.router.d.ts.map