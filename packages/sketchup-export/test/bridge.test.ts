import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { startBridge, type RunningBridge } from "../src/bridge.js";

const running: RunningBridge[] = [];
const validConfiguration: unknown = JSON.parse(
  readFileSync(new URL("../../space-schema/examples/A03023.json", import.meta.url), "utf8"),
);

afterEach(async () => {
  await Promise.all(running.splice(0).map((bridge) => bridge.close()));
});

async function launch(allowedOrigins: string[] = []): Promise<RunningBridge> {
  const bridge = await startBridge({ allowedOrigins });
  running.push(bridge);
  return bridge;
}

function headers(bridge: RunningBridge, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${bridge.token}`, ...extra };
}

describe("SketchUpBridge", () => {
  it("binds loopback and generates a fresh high-entropy token", async () => {
    const first = await launch();
    const second = await launch();
    expect(first.host).toBe("127.0.0.1");
    expect(new URL(first.url).hostname).toBe("127.0.0.1");
    expect(first.token).not.toBe(second.token);
    expect(Buffer.from(first.token, "base64url")).toHaveLength(32);
  });

  it("requires bearer auth and rejects unlisted origins", async () => {
    const bridge = await launch(["http://localhost:3000"]);
    const unauthenticated = await fetch(`${bridge.url}/health`);
    expect(unauthenticated.status).toBe(401);

    const forbiddenOrigin = await fetch(`${bridge.url}/health`, {
      headers: headers(bridge, { Origin: "https://evil.example" }),
    });
    expect(forbiddenOrigin.status).toBe(403);

    const allowed = await fetch(`${bridge.url}/health`, {
      headers: headers(bridge, { Origin: "http://localhost:3000" }),
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  it("rejects payloads that do not match SpaceConfiguration", async () => {
    const bridge = await launch();
    const response = await fetch(`${bridge.url}/v1/tasks`, {
      method: "POST",
      headers: headers(bridge, {
        "Content-Type": "application/json",
        "Idempotency-Key": "invalid-space",
      }),
      body: JSON.stringify({ configuration: { id: "not-enough-fields" } }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "INVALID_CONFIGURATION", message: "configuration does not match SpaceConfiguration" },
    });
  });

  it("runs the HTTP task lifecycle and returns an opaque stored result", async () => {
    const bridge = await launch();
    const create = await fetch(`${bridge.url}/v1/tasks`, {
      method: "POST",
      headers: headers(bridge, {
        "Content-Type": "application/json",
        "Idempotency-Key": "http-task-1",
      }),
      body: JSON.stringify({ configuration: validConfiguration }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { id: string };

    const replay = await fetch(`${bridge.url}/v1/tasks`, {
      method: "POST",
      headers: headers(bridge, {
        "Content-Type": "application/json",
        "Idempotency-Key": "http-task-1",
      }),
      body: JSON.stringify({ configuration: validConfiguration }),
    });
    expect(replay.status).toBe(200);

    const next = await fetch(`${bridge.url}/v1/plugin/tasks/next?waitMs=0`, { headers: headers(bridge) });
    expect(next.status).toBe(200);
    expect((await next.json() as { id: string }).id).toBe(created.id);

    for (const update of [
      { status: "MODEL_BUILDING", progress: 25 },
      { status: "MODEL_VALIDATING", progress: 75, components: { total: 1, succeeded: 1 } },
      { status: "EXPORTING", progress: 90 },
    ]) {
      const response = await fetch(`${bridge.url}/v1/plugin/tasks/${created.id}`, {
        method: "PATCH",
        headers: headers(bridge, { "Content-Type": "application/json" }),
        body: JSON.stringify(update),
      });
      expect(response.status).toBe(200);
    }

    const bytes = Buffer.from("binary model");
    const upload = await fetch(`${bridge.url}/v1/plugin/tasks/${created.id}/result`, {
      method: "POST",
      headers: headers(bridge, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        filename: "project.skp",
        contentType: "application/octet-stream",
        dataBase64: bytes.toString("base64"),
      }),
    });
    expect(upload.status).toBe(201);
    expect((await upload.json() as { status: string }).status).toBe("COMPLETED");

    const result = await fetch(`${bridge.url}/v1/tasks/${created.id}/result`, { headers: headers(bridge) });
    expect(result.status).toBe(200);
    expect(Buffer.from(await result.arrayBuffer())).toEqual(bytes);
    expect(result.headers.get("content-disposition")).toContain("project.skp");
  });

  it("does not accept a result filename containing a path", async () => {
    const bridge = await launch();
    const task = bridge.store.create({ id: "space" } as never, "bad-path").task;
    await bridge.store.claimNext(0);
    bridge.store.update(task.id, { status: "MODEL_BUILDING" });
    bridge.store.update(task.id, { status: "MODEL_VALIDATING" });
    bridge.store.update(task.id, { status: "EXPORTING" });

    const response = await fetch(`${bridge.url}/v1/plugin/tasks/${task.id}/result`, {
      method: "POST",
      headers: headers(bridge, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        filename: "../outside.skp",
        contentType: "application/octet-stream",
        dataBase64: Buffer.from("x").toString("base64"),
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "INVALID_FILENAME", message: "Filename must be a normalized basename without path segments" },
    });
  });
});
