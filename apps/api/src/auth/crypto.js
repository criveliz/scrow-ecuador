import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
export async function hashPassword(password) {
    if (!password || password.length < 8) {
        throw new Error("Password must be at least 8 characters long");
    }
    const salt = randomBytes(16).toString("hex");
    const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH));
    return `${salt}:${derivedKey.toString("hex")}`;
}
export async function verifyPassword(password, storedHash) {
    if (!password || !storedHash)
        return false;
    const parts = storedHash.split(":");
    if (parts.length !== 2)
        return false;
    const [salt, keyHex] = parts;
    const key = Buffer.from(keyHex, "hex");
    try {
        const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH));
        if (key.length !== derivedKey.length)
            return false;
        return timingSafeEqual(key, derivedKey);
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=crypto.js.map