import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { storeAssetFile } from "../../src/lib/storage/local-private-storage";

const previousStorage = process.env.PRIVATE_STORAGE_PATH;
let tempPath: string | undefined;

afterEach(async () => {
  if (tempPath) await rm(tempPath, { recursive: true, force: true });
  tempPath = undefined;
  if (previousStorage) process.env.PRIVATE_STORAGE_PATH = previousStorage;
  else delete process.env.PRIVATE_STORAGE_PATH;
});

describe("private asset ingestion", () => {
  it("normalizes EXIF orientation and deduplicates by SHA-256", async () => {
    tempPath = await mkdtemp(path.join(tmpdir(), "sharkflows-assets-"));
    process.env.PRIVATE_STORAGE_PATH = tempPath;
    const jpeg = await sharp({
      create: { width: 40, height: 20, channels: 3, background: "#ad835d" },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();

    const first = await storeAssetFile("project-1", new File([jpeg], "first.jpg", { type: "image/jpeg" }));
    const duplicate = await storeAssetFile("project-1", new File([jpeg], "renamed.jpg", { type: "image/jpeg" }));

    expect(first.widthPx).toBe(20);
    expect(first.heightPx).toBe(40);
    expect(first.sha256).toHaveLength(64);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.storagePath).toBe(first.storagePath);
  });

  it("rejects unsupported file types independently", async () => {
    tempPath = await mkdtemp(path.join(tmpdir(), "sharkflows-assets-"));
    process.env.PRIVATE_STORAGE_PATH = tempPath;
    await expect(storeAssetFile("project-1", new File(["x"], "unsafe.svg", { type: "image/svg+xml" })))
      .rejects.toThrow(/UNSUPPORTED_TYPE/);
  });
});
