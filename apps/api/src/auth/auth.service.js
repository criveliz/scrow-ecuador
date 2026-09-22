import { createHash, randomBytes } from "crypto";
import { ActorRole } from "@escrow-ecuador/domain";
import { hashPassword, verifyPassword } from "./crypto.js";
import { generateToken, verifyToken } from "./jwt.js";
import { requiresMfa, validateRole } from "./rbac.js";
const ACCESS_TOKEN_EXPIRY = 15 * 60; // 15 minutes
const REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60; // 7 days
export class AuthService {
    userRepo;
    refreshTokenRepo;
    constructor(userRepo, refreshTokenRepo) {
        this.userRepo = userRepo;
        this.refreshTokenRepo = refreshTokenRepo;
    }
    hashToken(token) {
        return createHash("sha256").update(token).digest("hex");
    }
    async register(data) {
        if (!data.email || !data.email.includes("@")) {
            throw new Error("Invalid email address");
        }
        if (!data.password || data.password.length < 8) {
            throw new Error("Password must be at least 8 characters");
        }
        const existingUser = await this.userRepo.findByEmail(data.email.toLowerCase().trim());
        if (existingUser) {
            throw new Error("User with this email already exists");
        }
        // Enforce Public Registration Role Security:
        // Public registration via /api/v1/auth/register ONLY allows BUYER or SELLER.
        // Any requested administrative/privileged role (ADMIN, SUPER_ADMIN, SUPPORT, SYSTEM) is overridden to BUYER.
        let role = validateRole(data.role || ActorRole.BUYER);
        if (requiresMfa(role) || role === ActorRole.SUPPORT || role === ActorRole.SYSTEM) {
            role = ActorRole.BUYER;
        }
        let mfaVerified = false;
        const passwordHash = await hashPassword(data.password);
        const user = await this.userRepo.create({
            email: data.email.toLowerCase().trim(),
            phone: data.phone ?? null,
            password_hash: passwordHash,
            role,
            status: "ACTIVE",
        });
        return this.generateAuthTokens(user, mfaVerified);
    }
    async login(data) {
        if (!data.email || !data.password) {
            throw new Error("Email and password are required");
        }
        const user = await this.userRepo.findByEmail(data.email.toLowerCase().trim());
        if (!user) {
            throw new Error("Invalid email or password");
        }
        const isPasswordValid = await verifyPassword(data.password, user.password_hash);
        if (!isPasswordValid) {
            throw new Error("Invalid email or password");
        }
        let mfaVerified = false;
        if (requiresMfa(user.role)) {
            if (process.env.NODE_ENV === "production") {
                throw new Error("MFA implementation for production requires valid TOTP token provider");
            }
            if (!data.mfaCode || data.mfaCode !== "123456") {
                throw new Error("MFA code required for privileged role");
            }
            mfaVerified = true;
        }
        return this.generateAuthTokens(user, mfaVerified);
    }
    async refresh(data) {
        if (!data.refreshToken) {
            throw new Error("Refresh token is required");
        }
        let payload;
        try {
            payload = verifyToken(data.refreshToken);
        }
        catch {
            throw new Error("Invalid or expired refresh token");
        }
        if (payload.type !== "REFRESH") {
            throw new Error("Invalid token type");
        }
        const tokenHash = this.hashToken(data.refreshToken);
        const existingTokenRecord = await this.refreshTokenRepo.findByTokenHash(tokenHash);
        if (!existingTokenRecord) {
            throw new Error("Refresh token not recognized");
        }
        // Token Reuse Detection / Theft Detection!
        // If the token was already revoked, someone is reusing an old refresh token -> revoke entire family!
        if (existingTokenRecord.revoked) {
            await this.refreshTokenRepo.revokeFamily(existingTokenRecord.family_id);
            throw new Error("Refresh token reuse detected! Token family revoked for security.");
        }
        // Revoke the current refresh token
        await this.refreshTokenRepo.revoke(existingTokenRecord.id);
        const user = await this.userRepo.findById(payload.userId);
        if (!user || user.status !== "ACTIVE") {
            throw new Error("User disabled or not found");
        }
        // Rotate refresh token using same family_id
        return this.generateAuthTokens(user, payload.mfaVerified ?? false, existingTokenRecord.family_id);
    }
    async getMe(userId) {
        const user = await this.userRepo.findById(userId);
        if (!user) {
            throw new Error("User not found");
        }
        const { password_hash, ...profile } = user;
        return profile;
    }
    async generateAuthTokens(user, mfaVerified, existingFamilyId) {
        const familyId = existingFamilyId || randomBytes(16).toString("hex");
        const accessToken = generateToken({
            userId: user.id,
            email: user.email,
            role: user.role,
            mfaVerified,
            type: "ACCESS",
        }, ACCESS_TOKEN_EXPIRY);
        const refreshToken = generateToken({
            userId: user.id,
            email: user.email,
            role: user.role,
            mfaVerified,
            type: "REFRESH",
        }, REFRESH_TOKEN_EXPIRY);
        const refreshTokenHash = this.hashToken(refreshToken);
        const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY * 1000);
        await this.refreshTokenRepo.create({
            user_id: user.id,
            token_hash: refreshTokenHash,
            family_id: familyId,
            expires_at: expiresAt,
        });
        const { password_hash, ...userProfile } = user;
        return {
            accessToken,
            refreshToken,
            user: userProfile,
        };
    }
}
//# sourceMappingURL=auth.service.js.map