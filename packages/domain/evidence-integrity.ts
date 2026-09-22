import crypto from "crypto";

export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export const DANGEROUS_EXTENSIONS: ReadonlySet<string> = new Set([
  ".exe",
  ".sh",
  ".bat",
  ".cmd",
  ".js",
  ".vbs",
  ".php",
  ".py",
  ".pl",
  ".cgi",
  ".dll",
  ".so",
  ".dylib",
  ".app",
  ".scr",
  ".pif",
  ".application",
  ".gadget",
  ".msi",
  ".msp",
  ".com",
  ".hta",
  ".cpl",
  ".msc",
  ".jar",
  ".bash",
  ".ps1",
  ".psm1",
]);

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export class InvalidEvidenceFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEvidenceFileError";
  }
}

export class EvidenceIntegrityMismatchError extends Error {
  constructor(public readonly expectedHash: string, public readonly actualHash: string) {
    super(`Evidence integrity check failed: expected hash ${expectedHash}, got ${actualHash}`);
    this.name = "EvidenceIntegrityMismatchError";
  }
}

export class SensitiveDataDetectedError extends Error {
  constructor(message?: string) {
    super(message ?? "Sensitive payment or identity data detected in evidence submission!");
    this.name = "SensitiveDataDetectedError";
  }
}

export function validateMimeType(mimeType: string): void {
  if (!mimeType || typeof mimeType !== "string") {
    throw new InvalidEvidenceFileError("MIME type is required");
  }
  const normalized = mimeType.trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(normalized)) {
    throw new InvalidEvidenceFileError(`MIME type '${mimeType}' is not allowed`);
  }
}

export function validateFileSize(fileSize: number, maxBytes = MAX_FILE_SIZE_BYTES): void {
  if (typeof fileSize !== "number" || isNaN(fileSize) || fileSize <= 0) {
    throw new InvalidEvidenceFileError("File size must be greater than 0");
  }
  if (fileSize > maxBytes) {
    throw new InvalidEvidenceFileError(
      `File size (${fileSize} bytes) exceeds maximum permitted limit (${maxBytes} bytes)`
    );
  }
}

export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== "string") {
    throw new InvalidEvidenceFileError("Filename is required");
  }

  // Check for path traversal attempts
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\") || filename.includes("\0")) {
    throw new InvalidEvidenceFileError("Filename contains invalid or path traversal characters");
  }

  const cleanName = filename.replace(/[^\w\.\-]/g, "_").trim();
  if (cleanName === "") {
    throw new InvalidEvidenceFileError("Invalid filename");
  }

  const lower = cleanName.toLowerCase();
  for (const ext of DANGEROUS_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      throw new InvalidEvidenceFileError(`File extension '${ext}' is dangerous and strictly prohibited`);
    }
  }

  return cleanName;
}

export function calculateSha256(content: Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function verifySha256(content: Buffer | Uint8Array, expectedHash: string): boolean {
  const actualHash = calculateSha256(content);
  return actualHash.toLowerCase() === expectedHash.toLowerCase();
}

/**
  Checks for sensitive card data patterns (13-19 digit card numbers passing basic regex pattern).
 */
export function checkSensitiveData(text: string): void {
  if (!text) return;
  // Regex for potential credit card number (13 to 19 digits)
  const cardRegex = /\b(?:\d[ -]*?){13,19}\b/g;
  const matches = text.match(cardRegex);
  if (matches) {
    for (const match of matches) {
      const digits = match.replace(/\D/g, "");
      if (digits.length >= 13 && digits.length <= 19) {
        throw new SensitiveDataDetectedError("Raw credit card number pattern detected");
      }
    }
  }
}
