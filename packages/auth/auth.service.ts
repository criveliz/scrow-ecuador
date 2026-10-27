import {
  UserRepository,
  User,
  RefreshTokenRepository,
  DbClient,
} from "@escrow-ecuador/database";
import { ActorRole } from "@escrow-ecuador/domain";
import {
  hashPassword,
  verifyPassword,
  generateRandomToken,
  hashToken,
} from "./crypto.js";
import { generateToken } from "./jwt.js";
import crypto from "crypto";

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly db: DbClient,
  ) {}

  async register(
    email: string,
    passwordRaw: string,
    role: ActorRole,
    phone?: string,
  ): Promise<{ user: User; accessToken: string; refreshToken: string }> {
    const existing = await this.userRepository.findByEmail(email);
    if (existing) {
      throw new AuthenticationError("User with this email already exists");
    }

    const passwordHash = await hashPassword(passwordRaw);

    const user = await this.userRepository.create({
      email,
      password_hash: passwordHash,
      role,
      status: "ACTIVE",
      phone: phone ?? null,
    });

    const payload = {
      userId: user.id,
      role: user.role,
      tokenVersion: user.token_version,
    };
    const accessToken = generateToken(payload);

    const refreshToken = generateRandomToken();
    const hashedToken = hashToken(refreshToken);
    const familyId = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiration

    await this.refreshTokenRepository.create(
      user.id,
      hashedToken,
      familyId,
      expiresAt,
    );

    return { user, accessToken, refreshToken };
  }

  async login(
    email: string,
    passwordRaw: string,
  ): Promise<{ user: User; accessToken: string; refreshToken: string }> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new AuthenticationError("Invalid email or password");
    }

    if (user.status !== "ACTIVE") {
      throw new AuthenticationError("User account is not active");
    }

    const isValid = await verifyPassword(passwordRaw, user.password_hash);
    if (!isValid) {
      throw new AuthenticationError("Invalid email or password");
    }

    const payload = {
      userId: user.id,
      role: user.role,
      tokenVersion: user.token_version,
    };
    const accessToken = generateToken(payload);

    const refreshToken = generateRandomToken();
    const hashedToken = hashToken(refreshToken);
    const familyId = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiration

    await this.refreshTokenRepository.create(
      user.id,
      hashedToken,
      familyId,
      expiresAt,
    );

    return { user, accessToken, refreshToken };
  }

  async refresh(
    token: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const hashedToken = hashToken(token);

    return await this.db.transaction(async (tx) => {
      const storedToken = await this.refreshTokenRepository.findByHashForUpdate(
        hashedToken,
        tx,
      );

      if (!storedToken) {
        throw new AuthenticationError("Invalid refresh token");
      }

      if (new Date(storedToken.expires_at).getTime() < Date.now()) {
        throw new AuthenticationError("Refresh token expired");
      }

      if (storedToken.is_revoked) {
        // Session Breach Detected
        await this.refreshTokenRepository.revokeFamily(
          storedToken.family_id,
          tx,
        );
        throw new AuthenticationError(
          "Security breach detected: invalid refresh token replay",
        );
      }

      // Valid token. Find user to check active status and token version.
      const user = await this.userRepository.findById(storedToken.user_id);

      if (!user) {
        throw new AuthenticationError("User not found");
      }

      if (user.status !== "ACTIVE") {
        throw new AuthenticationError("User account is not active");
      }

      // Revoke the current token
      await this.refreshTokenRepository.revoke(hashedToken, tx);

      // Issue new token pair
      const payload = {
        userId: user.id,
        role: user.role,
        tokenVersion: user.token_version,
      };
      const newAccessToken = generateToken(payload);

      const newRefreshToken = generateRandomToken();
      const newHashedToken = hashToken(newRefreshToken);

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await this.refreshTokenRepository.create(
        user.id,
        newHashedToken,
        storedToken.family_id,
        expiresAt,
        tx,
      );

      return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    });
  }
}
