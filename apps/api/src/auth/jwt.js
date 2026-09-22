import { createHmac, randomBytes, timingSafeEqual } from "crypto";
const DEFAULT_SECRET = "escrow-ecuador-dev-jwt-secret-do-not-use-in-production";
function getJwtSecret(overrideSecret) {
    if (overrideSecret)
        return overrideSecret;
    const envSecret = process.env.JWT_SECRET;
    if (envSecret && envSecret.trim() !== "") {
        return envSecret;
    }
    if (process.env.NODE_ENV === "production") {
        throw new Error("FATAL: JWT_SECRET environment variable is strictly required in production!");
    }
    return DEFAULT_SECRET;
}
function base64UrlEncode(str) {
    return Buffer.from(str)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}
function base64UrlDecode(str) {
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) {
        base64 += "=";
    }
    return Buffer.from(base64, "base64").toString("utf-8");
}
function signPayload(headerAndPayload, secret) {
    return createHmac("sha256", secret)
        .update(headerAndPayload)
        .digest("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}
export function generateToken(payload, expiresInSeconds, secret) {
    const activeSecret = getJwtSecret(secret);
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = {
        ...payload,
        iat: now,
        exp: now + expiresInSeconds,
        jti: payload.jti || randomBytes(16).toString("hex"),
    };
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
    const signature = signPayload(`${encodedHeader}.${encodedPayload}`, activeSecret);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
}
export function verifyToken(token, secret) {
    const activeSecret = getJwtSecret(secret);
    if (!token) {
        throw new Error("Token is required");
    }
    const parts = token.split(".");
    if (parts.length !== 3) {
        throw new Error("Invalid token format");
    }
    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSignature = signPayload(`${encodedHeader}.${encodedPayload}`, activeSecret);
    const sigBuf = Buffer.from(signature);
    const expectedSigBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expectedSigBuf.length || !timingSafeEqual(sigBuf, expectedSigBuf)) {
        throw new Error("Invalid token signature");
    }
    const payloadStr = base64UrlDecode(encodedPayload);
    const payload = JSON.parse(payloadStr);
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
        throw new Error("Token expired");
    }
    return payload;
}
//# sourceMappingURL=jwt.js.map