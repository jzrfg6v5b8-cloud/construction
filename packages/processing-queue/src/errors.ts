import type { SanitizedError } from "./types.js";

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:bearer|basic)\s+[a-z0-9._~+/-]+=*/gi,
  /\b(?:api[_-]?key|authorization|password|secret|token)\s*[:=]\s*["']?[^"',\s}]+/gi,
  /(?:redis|https?):\/\/[^@\s/]+@/gi,
  /\bsk-[a-z0-9_-]{8,}\b/gi,
];

export class QueueProcessingError extends Error {
  override readonly name = "QueueProcessingError";
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, options: { code?: string; retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.code = options.code ?? "PROCESSING_ERROR";
    this.retryable = options.retryable ?? true;
  }
}

function redact(value: string): string {
  return SECRET_PATTERNS.reduce(
    (message, pattern) => message.replace(pattern, (match) => {
      const protocol = match.match(/^(?:redis|https?):\/\//i)?.[0];
      return protocol ? `${protocol}[REDACTED]@` : "[REDACTED]";
    }),
    value,
  ).slice(0, 500);
}

export function sanitizeError(error: unknown): SanitizedError {
  if (error instanceof QueueProcessingError) {
    return {
      name: error.name,
      code: redact(error.code),
      message: redact(error.message),
      retryable: error.retryable,
    };
  }

  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: unknown };
    return {
      name: redact(error.name || "Error"),
      code: typeof errorWithCode.code === "string" ? redact(errorWithCode.code) : "UNEXPECTED_ERROR",
      message: redact(error.message || "Unexpected processing error"),
      retryable: true,
    };
  }

  return {
    name: "Error",
    code: "UNEXPECTED_ERROR",
    message: redact(typeof error === "string" ? error : "Unexpected processing error"),
    retryable: true,
  };
}
