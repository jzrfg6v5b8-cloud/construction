import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb, resetDbForTests } from "../../src/lib/db/client";
import {
  createProject,
  ensureDemoProject,
  listAssets,
  listProjects,
  upsertAsset,
} from "../../src/lib/db/repositories";

let tempDir: string | undefined;

afterEach(() => {
  closeDb();
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("projects persistence", () => {
  it("creates projects and lists them with asset counts", () => {
    tempDir = path.join(tmpdir(), `sharkflows-prj-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    resetDbForTests(path.join(tempDir, "t.sqlite"));

    const demo = ensureDemoProject();
    expect(demo.id).toBe("demo");
    expect(ensureDemoProject().id).toBe("demo");

    const project = createProject({ name: "测试项目", address: "杭州" });
    expect(project.name).toBe("测试项目");

    upsertAsset({
      id: "ast_test_1",
      project_id: project.id,
      original_filename: "plan.jpg",
      mime_type: "image/jpeg",
      size_bytes: 100,
      sha256: "abc",
      storage_path: "k",
      asset_type: "image",
    });

    const found = listProjects().find((item) => item.id === project.id);
    expect(found?.asset_count).toBe(1);
    expect(listAssets(project.id)).toHaveLength(1);
  });
});
