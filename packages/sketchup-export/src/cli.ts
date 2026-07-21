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
const projectId = (process.env.SKETCHUP_PROJECT_ID ?? "").trim();

let cloudPoller: CloudTaskPoller | undefined;
if (cloudUrl && cloudSecret && projectId) {
  cloudPoller = new CloudTaskPoller(
    {
      cloudUrl,
      projectId,
      secret: cloudSecret,
      claimedBy: `bridge_${randomBytes(4).toString("hex")}`,
      pollIntervalMs: Number(process.env.SKETCHUP_CLOUD_POLL_MS ?? 2000),
      onLog: (event, details) => {
        process.stdout.write(
          `${JSON.stringify({ event: `sketchup_bridge.cloud.${event}`, ...details, at: new Date().toISOString() })}\n`,
        );
      },
    },
    {
      createTask: (configuration, idempotencyKey) =>
        bridge.store.create(configuration as never, idempotencyKey).task,
      getTask: (id) => {
        try {
          return bridge.store.get(id);
        } catch (error) {
          if (error instanceof StoreError && error.code === "TASK_NOT_FOUND") return null;
          throw error;
        }
      },
      listTasks: () => bridge.store.list(),
      getResultBytes: (taskId, resultId) => {
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
    },
  );
  cloudPoller.start();
}

process.stdout.write(
  `${JSON.stringify({
    event: "sketchup_bridge.started",
    url: bridge.url,
    token: bridge.token,
    allowedOrigins,
    cloudQueue: Boolean(cloudPoller),
    cloudUrl: cloudPoller ? cloudUrl : null,
    projectId: cloudPoller ? projectId : null,
    hint: cloudPoller
      ? "Cloud queue enabled: open Vercel site and click 发送到SketchUp; keep this process running."
      : "Local-only mode. For Vercel: set SKETCHUP_CLOUD_URL, SKETCHUP_BRIDGE_SECRET, SKETCHUP_PROJECT_ID.",
  })}\n`,
);

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`${JSON.stringify({ event: "sketchup_bridge.stopping", signal })}\n`);
  await cloudPoller?.stop();
  await bridge.close();
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
