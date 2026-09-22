import { DbClient } from "../db.js";
export interface RefreshTokenRecord {
    id: string;
    user_id: string;
    token_hash: string;
    family_id: string;
    revoked: boolean;
    expires_at: Date;
    created_at: Date;
    updated_at: Date;
}
export declare class RefreshTokenRepository {
    private readonly db;
    constructor(db: DbClient);
    create(data: {
        user_id: string;
        token_hash: string;
        family_id: string;
        expires_at: Date;
    }): Promise<RefreshTokenRecord>;
    findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
    revoke(id: string): Promise<void>;
    revokeFamily(familyId: string): Promise<void>;
}
//# sourceMappingURL=refresh-token.repository.d.ts.map