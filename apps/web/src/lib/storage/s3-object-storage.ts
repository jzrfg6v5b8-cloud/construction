import {
  ObjectStorageConfigurationError,
  type ObjectPutResult,
  type ObjectStorage,
} from "./object-storage";

export type S3ObjectStorageConfig = {
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

/**
 * Reserved S3/R2 adapter. Throws a clear error when bucket/credentials are missing,
 * and throws “not wired” once configured until an AWS SDK client is integrated.
 */
export class S3ObjectStorage implements ObjectStorage {
  readonly driver = "s3" as const;
  readonly #config: Required<Pick<S3ObjectStorageConfig, "bucket">> & S3ObjectStorageConfig;

  constructor(config: S3ObjectStorageConfig = {}) {
    const bucket = config.bucket ?? process.env.S3_BUCKET ?? process.env.AWS_S3_BUCKET;
    if (!bucket) {
      throw new ObjectStorageConfigurationError(
        "S3ObjectStorage is not configured. Set S3_BUCKET (and AWS credentials), or use LocalObjectStorage / createObjectStorage() without S3 env vars.",
      );
    }
    const accessKeyId = config.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = config.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) {
      throw new ObjectStorageConfigurationError(
        "S3ObjectStorage requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY. For local development use LocalObjectStorage.",
      );
    }
    this.#config = {
      ...config,
      bucket,
      accessKeyId,
      secretAccessKey,
      region: config.region ?? process.env.AWS_REGION ?? "auto",
      endpoint: config.endpoint ?? process.env.S3_ENDPOINT,
    };
  }

  async put(): Promise<ObjectPutResult> {
    throw this.#notImplemented("put");
  }

  async get(): Promise<Buffer> {
    throw this.#notImplemented("get");
  }

  async delete(): Promise<void> {
    throw this.#notImplemented("delete");
  }

  async exists(): Promise<boolean> {
    throw this.#notImplemented("exists");
  }

  async signedUrl(): Promise<string> {
    throw this.#notImplemented("signedUrl");
  }

  #notImplemented(method: string): ObjectStorageConfigurationError {
    return new ObjectStorageConfigurationError(
      `S3ObjectStorage.${method} is reserved but not wired to an AWS SDK yet (bucket=${this.#config.bucket}). Install/configure the S3 client integration before using remote object storage.`,
    );
  }
}
