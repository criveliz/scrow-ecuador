export class CipherByteError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "CipherByteError";
  }
}

export class CipherByteAuthError extends CipherByteError {
  constructor(
    message: string = "Authentication or authorization failed with CipherByte API",
    statusCode: number = 401,
  ) {
    super(message, statusCode);
    this.name = "CipherByteAuthError";
  }
}

export class CipherByteNotFoundError extends CipherByteError {
  constructor(
    message: string = "Resource not found in CipherByte API",
    statusCode: number = 404,
  ) {
    super(message, statusCode);
    this.name = "CipherByteNotFoundError";
  }
}

export class CipherByteRateLimitError extends CipherByteError {
  constructor(
    message: string = "CipherByte API rate limit exceeded",
    statusCode: number = 429,
  ) {
    super(message, statusCode);
    this.name = "CipherByteRateLimitError";
  }
}

export class CipherByteTimeoutError extends CipherByteError {
  constructor(message: string = "CipherByte API request timed out") {
    super(message);
    this.name = "CipherByteTimeoutError";
  }
}

export class CipherByteServerError extends CipherByteError {
  constructor(
    message: string = "CipherByte API returned a server error",
    statusCode: number = 500,
  ) {
    super(message, statusCode);
    this.name = "CipherByteServerError";
  }
}

export class CipherByteInvalidResponseError extends CipherByteError {
  constructor(
    message: string = "CipherByte API returned an invalid response format",
  ) {
    super(message);
    this.name = "CipherByteInvalidResponseError";
  }
}

export class InvalidInputValidationError extends CipherByteError {
  constructor(message: string) {
    super(message, 400);
    this.name = "InvalidInputValidationError";
  }
}
