import { ServerResponse } from "http";
import { AuthenticatedRequest } from "../auth/auth.middleware.js";
import { EscrowService } from "./escrow.service.js";
export declare function handleEscrowRoutes(req: AuthenticatedRequest, res: ServerResponse, escrowService: EscrowService, urlPath: string): boolean;
//# sourceMappingURL=escrow.router.d.ts.map