#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { startBridge } from "./bridge.js";
import { CloudTaskPoller } from "./cloud-poller.js";
import { StoreError } from "./task-store.js";

function parsePort(value: string | undefined): number {
  if (value === undefined) return 43_821;
  if (!/^\d+$/.test(value)) throw new Error("SKETCHUP_BRIDGE_PORT must be an integer");
  const port = Number(value);
  if (port < 0 || port > 65_535) throw new Error("SKETCHUP_BRIDGE_PORT must be between 0 and 65535");
  return port;
}

function parseProjectIds(): string[] {
  const multi = (process.env.SKETCHUP_PROJECT_IDS ?? "").trim();
  const single = (process.env.SKETCHUP_PROJECT_ID ?? "").trim();
  const raw = multi || single;
  return [...new Set(raw.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean))];
}

const allowedOrigins = (
  process.env.SKETCHUP_BRIDGE_ORIGINS ??
  "http://localhost:3000,http://127.0.0.1:3000,https://construction-web-murex.vercel.app"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const bridge = await startBridge({
  port: parsePort(process.env.SKETCHUP_BRIDGE_PORT),
  allowedOrigins,
});

const cloudUrl = (process.env.SKETCHUP_CLOUD_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
const cloudSecret = (
  process.env.SKETCHUP_BRIDGE_SECRET ??
  process.env.SKETCHUP_RESULT_WEBHOOK_SECRET ??
  ""
).trim();
const projectIds = parseProjectIds();
const claimedBy = `bridge_${randomBytes(4).toString("hex")}`;

const localAdapter = {
  createTask: (configuration: unknown, idempotencyKey: string) =>
    bridge.store.create(configuration as never, idempotencyKey).task,
  getTask: (id: string) => {
    try {
      return bridge.store.get(id);
    } catch (error) {
      if (error instanceof StoreError && error.code === "TASK_NOT_FOUND") return null;
      throw error;
    }
  },
  listTasks: () => bridge.store.list(),
  getResultBytes: (taskId: string, resultId?: string) => {
    try {
      const stored = bridge.store.getResult(taskId, resultId);
      return {
        filename: stored.metadata.filename,
        contentType: stored.metadata.contentType,
        bytes: stored.bytes,
      };
    } catch {
      return null;
    }
  },
};

const cloudPollers: CloudTaskPoller[] = [];
if (cloudUrl && cloudSecret && projectIds.length) {
  for (const projectId of projectIds) {
    const poller = new CloudTaskPoller(
      {
        cloudUrl,
        projectId,
        secret: cloudSecret,
        claimedBy,
        pollIntervalMs: Number(process.env.SKETCHUP_CLOUD_POLL_MS ?? 2000),
        onLog: (event, details) => {
          process.stdout.write(
            `${JSON.stringify({
              event: `sketchup_bridge.cloud.${event}`,
              projectId,
              ...details,
              at: new Date().toISOString(),
            })}\n`,
          );
        },
      },
      localAdapter,
    );
    poller.start();
    cloudPollers.push(poller);
  }
}

process.stdout.write(
  `${JSON.stringify({
    event: "sketchup_bridge.started",
    url: bridge.url,
    token: bridge.token,
    allowedOrigins,
    cloudQueue: cloudPollers.length > 0,
    cloudUrl: cloudPollers.length ? cloudUrl : null,
    projectIds: cloudPollers.length ? projectIds : [],
    hint: cloudPollers.length
      ? `Cloud queue enabled for ${projectIds.length} project(s). On Vercel open any of them and click 发送到SketchUp.`
      : "Local-only mode. For Vercel: set SKETCHUP_CLOUD_URL, SKETCHUP_BRIDGE_SECRET, and SKETCHUP_PROJECT_IDS=prj_a,prj_b",
  })}\n`,
);

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`${JSON.stringify({ event: "sketchup_bridge.stopping", signal })}\n`);
  await Promise.all(cloudPollers.map((p) => p.stop()));
  await bridge.close();
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
