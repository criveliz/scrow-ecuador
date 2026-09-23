import {
  CipherByteAuthError,
  CipherByteError,
  CipherByteInvalidResponseError,
  CipherByteNotFoundError,
  CipherByteRateLimitError,
  CipherByteServerError,
  CipherByteTimeoutError,
  InvalidInputValidationError,
} from "./errors.js";
import {
  CipherByteCedulaResponse,
  CipherByteClientConfig,
  CipherByteCompanySearchResponseItem,
  CipherByteLicenciaResponse,
  CipherByteRucResponse,
  CipherByteSaldoResponse,
  CipherByteVehiculoResponse,
} from "./types.js";

export function redactSecrets(text: string, secrets: string[] = []): string {
  let result = text;
  for (const secret of secrets) {
    if (secret && secret.trim().length > 0) {
      result = result.split(secret).join("[REDACTED]");
    }
  }
  // Generic redaction for X-Api-Key headers or key parameters if present
  result = result.replace(/(x-api-key\s*:\s*)[^\s,;]+/gi, "$1[REDACTED]");
  result = result.replace(/(api_key\s*=\s*)[^\s&]+/gi, "$1[REDACTED]");
  return result;
}

export function sanitizeCedula(cedula: string): string {
  const clean = (cedula || "").trim().replace(/\D/g, "");
  if (!/^\d{10}$/.test(clean)) {
    throw new InvalidInputValidationError(
      `Invalid Cédula format. Expected 10 digits, got: ${cedula}`,
    );
  }
  return clean;
}

export function sanitizePlate(plate: string): string {
  const clean = (plate || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{3}\d{3,4}$/.test(clean)) {
    throw new InvalidInputValidationError(
      `Invalid vehicle plate format. Expected e.g. PBA1234 or ABC123, got: ${plate}`,
    );
  }
  return clean;
}

export function sanitizeRuc(ruc: string): string {
  const clean = (ruc || "").trim().replace(/\D/g, "");
  if (!/^\d{13}$/.test(clean)) {
    throw new InvalidInputValidationError(
      `Invalid RUC format. Expected 13 digits, got: ${ruc}`,
    );
  }
  return clean;
}

export class CipherByteClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: CipherByteClientConfig = {}, customFetch?: typeof fetch) {
    const rawUrl =
      config.baseUrl ||
      process.env.CIPHERBYTE_BASE_URL ||
      "https://gateway.cipherbyte.ec";
    this.baseUrl = rawUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey || process.env.CIPHERBYTE_API_KEY || "";
    this.timeoutMs = config.timeoutMs ?? 5000;
    this.maxRetries = config.maxRetries ?? 1;
    this.fetchImpl = customFetch || globalThis.fetch;

    this.validateBaseUrl(this.baseUrl);
  }

  private validateBaseUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new CipherByteError(`Invalid CipherByte base URL: ${url}`);
    }

    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      throw new CipherByteError(
        "CipherByte base URL must use HTTPS in production for security",
      );
    }
  }

  private redact(str: string): string {
    return redactSecrets(str, [this.apiKey]);
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const headers: Record<string, string> = {
          Accept: "application/json",
          "X-Api-Key": this.apiKey,
          ...(options.headers as Record<string, string>),
        };

        const response = await this.fetchImpl(url, {
          ...options,
          headers,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (response.status === 401 || response.status === 403) {
          throw new CipherByteAuthError(
            `Authentication failed (HTTP ${response.status}) for endpoint: ${endpoint}`,
            response.status,
          );
        }

        if (response.status === 404) {
          throw new CipherByteNotFoundError(
            `Resource not found for endpoint: ${endpoint}`,
          );
        }

        if (response.status === 429) {
          throw new CipherByteRateLimitError(
            `Rate limit exceeded for endpoint: ${endpoint}`,
          );
        }

        if (response.status >= 500) {
          if (attempt <= this.maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
            continue;
          }
          throw new CipherByteServerError(
            `Server error (HTTP ${response.status}) from CipherByte for endpoint: ${endpoint}`,
            response.status,
          );
        }

        if (!response.ok) {
          throw new CipherByteError(
            `CipherByte request failed with HTTP status ${response.status}`,
          );
        }

        let data: unknown;
        try {
          data = await response.json();
        } catch {
          throw new CipherByteInvalidResponseError(
            `Invalid JSON response from CipherByte endpoint: ${endpoint}`,
          );
        }

        return data as T;
      } catch (err: unknown) {
        clearTimeout(timer);

        if (err instanceof CipherByteError) {
          throw err;
        }

        if ((err as Error)?.name === "AbortError") {
          if (attempt <= this.maxRetries) {
            continue;
          }
          throw new CipherByteTimeoutError(
            `Request to CipherByte endpoint ${endpoint} timed out after ${this.timeoutMs}ms`,
          );
        }

        if (attempt <= this.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
          continue;
        }

        throw new CipherByteError(
          `Network error communicating with CipherByte: ${(err as Error)?.message || String(err)}`,
        );
      }
    }

    throw new CipherByteError(
      `Failed request to CipherByte after ${this.maxRetries} retries`,
    );
  }

  async getSaldo(): Promise<CipherByteSaldoResponse> {
    return this.request<CipherByteSaldoResponse>("/api/saldo");
  }

  async getCedula(cedula: string): Promise<CipherByteCedulaResponse> {
    const clean = sanitizeCedula(cedula);
    return this.request<CipherByteCedulaResponse>(`/api/cedula/${clean}`);
  }

  async getLicencia(cedula: string): Promise<CipherByteLicenciaResponse> {
    const clean = sanitizeCedula(cedula);
    return this.request<CipherByteLicenciaResponse>(`/api/licencia/${clean}`);
  }

  async getVehiculo(plate: string): Promise<CipherByteVehiculoResponse> {
    const clean = sanitizePlate(plate);
    return this.request<CipherByteVehiculoResponse>(`/api/vehiculo/${clean}`);
  }

  async searchCompanias(
    query: string,
  ): Promise<CipherByteCompanySearchResponseItem[]> {
    const cleanQuery = encodeURIComponent((query || "").trim());
    return this.request<CipherByteCompanySearchResponseItem[]>(
      `/api/companias/buscar?query=${cleanQuery}`,
    );
  }

  async getRuc(ruc: string): Promise<CipherByteRucResponse> {
    const clean = sanitizeRuc(ruc);
    return this.request<CipherByteRucResponse>(`/api/ruc/${clean}`);
  }
}
