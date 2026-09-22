import { ActorRole } from "@escrow-ecuador/domain";
export interface TokenPayload {
    userId: string;
    email: string;
    role: ActorRole | string;
    mfaVerified?: boolean;
    type: "ACCESS" | "REFRESH";
    iat: number;
    exp: number;
    jti?: string;
}
export declare function generateToken(payload: Omit<TokenPayload, "iat" | "exp">, expiresInSeconds: number, secret?: string): string;
export declare function verifyToken(token: string, secret?: string): TokenPayload;
//# sourceMappingURL=jwt.d.ts.map