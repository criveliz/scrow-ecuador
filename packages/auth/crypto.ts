import crypto from "crypto";

// Security Hardening: High-cost scrypt parameters for password hashing
const SCRYPT_COST = 32768; // N
const SCRYPT_BLOCK_SIZE = 8; // r
const SCRYPT_PARALLELIZATION = 1; // p
const SCRYPT_KEY_LEN = 64;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_BYTES).toString("hex");
    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEY_LEN,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: 128 * 1024 * 1024,
      }, // increased maxmem to 128MB for N=32768
      (err, derivedKey) => {
        if (err) return reject(err);
        resolve(`${salt}:${derivedKey.toString("hex")}`);
      },
    );
  });
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, keyHex] = hash.split(":");
    if (!salt || !keyHex) {
      return resolve(false);
    }
    const keyBuffer = Buffer.from(keyHex, "hex");

    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEY_LEN,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: 128 * 1024 * 1024,
      }, // increased maxmem to 128MB
      (err, derivedKey) => {
        if (err) return reject(err);

        // Constant time comparison
        if (keyBuffer.length !== derivedKey.length) {
          return resolve(false);
        }
        resolve(crypto.timingSafeEqual(keyBuffer, derivedKey));
      },
    );
  });
}

export function generateRandomToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
