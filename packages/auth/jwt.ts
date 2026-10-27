import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET || "default_development_secret_key_12345";
const JWT_EXPIRES_IN = "1h";
const JWT_REFRESH_EXPIRES_IN = "7d";

export interface JwtPayload {
  userId: string;
  role: string;
  tokenVersion: number;
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
