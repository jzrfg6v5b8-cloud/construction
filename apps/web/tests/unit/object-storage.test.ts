import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createObjectStorage,
  LocalObjectStorage,
  ObjectStorageConfigurationError,
  S3ObjectStorage,
} from "../../src/lib/storage";

let tempDir: string | undefined;
const previous = {
  OBJECT_STORAGE_DRIVER: process.env.OBJECT_STORAGE_DRIVER,
  S3_BUCKET: process.env.S3_BUCKET,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
};

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("ObjectStorage", () => {
  it("stores and reads objects locally", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "sharkflows-objects-"));
    const storage = new LocalObjectStorage(tempDir);
    await storage.put({
      key: "a/b.txt",
      body: Buffer.from("hello"),
      contentType: "text/plain",
    });
    expect(await storage.exists("a/b.txt")).toBe(true);
    expect((await storage.get("a/b.txt")).toString("utf8")).toBe("hello");
    expect(storage.driver).toBe("local");
    await storage.delete("a/b.txt");
    expect(await storage.exists("a/b.txt")).toBe(false);
  });

  it("defaults createObjectStorage to LocalObjectStorage", () => {
    delete process.env.OBJECT_STORAGE_DRIVER;
    delete process.env.S3_BUCKET;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    expect(createObjectStorage()).toBeInstanceOf(LocalObjectStorage);
  });

  it("explains missing S3 configuration clearly", () => {
    expect(() => new S3ObjectStorage({})).toThrow(ObjectStorageConfigurationError);
    expect(() => new S3ObjectStorage({})).toThrow(/S3_BUCKET/);
  });
});
