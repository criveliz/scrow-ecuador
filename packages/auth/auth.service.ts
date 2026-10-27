import { UserRepository, User } from "@escrow-ecuador/database";
import { ActorRole } from "@escrow-ecuador/domain";
import { hashPassword, verifyPassword } from "./crypto.js";
import { generateToken, generateRefreshToken } from "./jwt.js";

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthService {
  constructor(private readonly userRepository: UserRepository) {}

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

    const payload = { userId: user.id, role: user.role };
    const accessToken = generateToken(payload);
    const refreshToken = generateRefreshToken(payload);

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

    const payload = { userId: user.id, role: user.role };
    const accessToken = generateToken(payload);
    const refreshToken = generateRefreshToken(payload);

    return { user, accessToken, refreshToken };
  }

  async refresh(
    userId: string,
    role: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // In a real application, you might want to verify the user still exists and is active,
    // and potentially check the refresh token against a stored list or revocation list.
    // For this implementation, we simply generate new tokens based on the payload.
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new AuthenticationError("User not found");
    }

    if (user.status !== "ACTIVE") {
      throw new AuthenticationError("User account is not active");
    }

    const payload = { userId, role: user.role };
    const accessToken = generateToken(payload);
    const refreshToken = generateRefreshToken(payload);

    return { accessToken, refreshToken };
  }
}
