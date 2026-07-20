import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObjectPutResult, ObjectStorage } from "./object-storage";

function storageRoot(configured = process.env.OBJECT_STORAGE_PATH ?? process.env.PRIVATE_STORAGE_PATH): string {
  const relative = configured ?? ".data/objects";
  return path.isAbsolute(relative) ? relative : path.resolve(process.cwd(), relative);
}

function resolveKeyPath(root: string, key: string): string {
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) {
    throw new Error("INVALID_OBJECT_KEY");
  }
  const full = path.resolve(root, key);
  if (!full.startsWith(path.resolve(root) + path.sep) && full !== path.resolve(root)) {
    throw new Error("INVALID_OBJECT_KEY");
  }
  return full;
}

export class LocalObjectStorage implements ObjectStorage {
  readonly driver = "local" as const;
  readonly #root: string;

  constructor(root = storageRoot()) {
    this.#root = root;
  }

  get root(): string {
    return this.#root;
  }

  async put(input: {
    key: string;
    body: Buffer | Uint8Array;
    contentType: string;
  }): Promise<ObjectPutResult> {
    const fullPath = resolveKeyPath(this.#root, input.key);
    await mkdir(path.dirname(fullPath), { recursive: true });
    const buffer = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);
    await writeFile(fullPath, buffer);
    await writeFile(`${fullPath}.meta.json`, JSON.stringify({ contentType: input.contentType }));
    return {
      key: input.key,
      sizeBytes: buffer.byteLength,
      contentType: input.contentType,
      absolutePath: fullPath,
    };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(resolveKeyPath(this.#root, key));
  }

  async delete(key: string): Promise<void> {
    const fullPath = resolveKeyPath(this.#root, key);
    await rm(fullPath, { force: true });
    await rm(`${fullPath}.meta.json`, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(resolveKeyPath(this.#root, key));
      return true;
    } catch {
      return false;
    }
  }

  async signedUrl(key: string): Promise<string> {
    const fullPath = resolveKeyPath(this.#root, key);
    return `file://${fullPath}`;
  }
}
