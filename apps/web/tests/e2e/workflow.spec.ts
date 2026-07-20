import { expect, test } from "@playwright/test";

test("opens projects workspace from home", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "每一张图、每一个尺寸，都有来源。" })).toBeVisible();
  await page.getByRole("link", { name: "打开项目工作区" }).click();
  await expect(page.getByRole("heading", { name: "项目工作区" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "新建项目" })).toBeVisible();
});

test("assets page lists real storage for a project", async ({ page }) => {
  await page.goto("/projects/demo/assets");
  await expect(page.getByRole("heading", { name: "素材库" })).toBeVisible();
  await expect(page.getByText("素材总数")).toBeVisible();
  await expect(page.getByRole("button", { name: /批量上传/ })).toBeVisible();
});

test("calibration route works under project id", async ({ page }) => {
  await page.goto("/projects/demo/calibration");
  await expect(page.getByRole("heading", { name: "户型校准" })).toBeVisible();
  await expect(page.getByText("素材总数")).toBeVisible();
});

test("proposal exposes draft PDF and final blockers", async ({ page, request }) => {
  await page.goto("/projects/demo/proposal");
  await expect(page.getByRole("heading", { name: "方案输出" })).toBeVisible();
  const finalResponse = await request.get("/api/projects/demo/proposal/export?status=FINAL");
  expect(finalResponse.status()).toBe(409);
  const draftResponse = await request.get("/api/projects/demo/proposal/export");
  expect([200, 503]).toContain(draftResponse.status());
  if (draftResponse.status() === 200) {
    expect(draftResponse.headers()["content-type"]).toContain("application/pdf");
  }
});

test("exports validated A03023 SpaceConfiguration and opens SketchUp sync", async ({ page, request }) => {
  const response = await request.get("/api/projects/demo/sketchup/configuration");
  expect(response.status()).toBe(200);
  const configuration = await response.json();
  expect(configuration).toMatchObject({
    projectId: "A03023",
    floorPlanCode: "A03023-2BR",
    geometryVersion: "gv-0003",
    dimensionsVerified: true,
  });

  await page.goto("/projects/demo/sketchup");
  await expect(page.getByRole("heading", { name: /SketchUp/ })).toBeVisible();
});
