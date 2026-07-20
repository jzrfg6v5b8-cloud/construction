import { createHmac, timingSafeEqual } from "node:crypto";
import { LocalObjectStorage } from "./local-object-storage";
import { S3ObjectStorage } from "./s3-object-storage";

export type ObjectPutResult = {
  key: string;
  sizeBytes: number;
  contentType: string;
  absolutePath?: string;
};

export interface ObjectStorage {
  readonly driver: "local" | "s3";
  put(input: {
    key: string;
    body: Buffer | Uint8Array;
    contentType: string;
  }): Promise<ObjectPutResult>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

export class ObjectStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStorageConfigurationError";
  }
}

export function objectKeyForAsset(projectId: string, filename: string): string {
  const safeProject = projectId.replace(/[^\w.-]+/g, "_").slice(0, 80);
  const safeName = filename.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120);
  return `projects/${safeProject}/assets/${Date.now()}_${safeName}`;
}

function signingSecret(): string | undefined {
  return process.env.SIGNED_URL_SECRET ?? process.env.OBJECT_STORAGE_SIGNING_SECRET;
}

export function createLocalObjectToken(key: string, expiresAt: number): string {
  const secret = signingSecret();
  if (!secret) throw new ObjectStorageConfigurationError("SIGNED_URL_SECRET_NOT_CONFIGURED");
  const payload = Buffer.from(JSON.stringify({ key, expiresAt })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyLocalObjectToken(token: string): { key: string; expiresAt: number } | null {
  const secret = signingSecret();
  if (!secret) return null;
  const [payload, provided] = token.split(".");
  if (!payload || !provided) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      key?: string;
      expiresAt?: number;
    };
    if (!parsed.key || typeof parsed.expiresAt !== "number" || parsed.expiresAt < Date.now()) {
      return null;
    }
    return { key: parsed.key, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function s3Configured(): boolean {
  return Boolean(
    (process.env.S3_BUCKET || process.env.AWS_S3_BUCKET)
    && process.env.AWS_ACCESS_KEY_ID
    && process.env.AWS_SECRET_ACCESS_KEY,
  );
}

/**
 * Local filesystem by default. Set OBJECT_STORAGE_DRIVER=s3 (with bucket + AWS keys)
 * to construct the reserved S3 adapter.
 */
export function createObjectStorage(): ObjectStorage {
  if (process.env.OBJECT_STORAGE_DRIVER === "s3" || s3Configured()) {
    return new S3ObjectStorage();
  }
  return new LocalObjectStorage();
}

export { LocalObjectStorage } from "./local-object-storage";
export { S3ObjectStorage } from "./s3-object-storage";
