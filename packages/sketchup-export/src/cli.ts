#!/usr/bin/env node
import { startBridge } from "./bridge.js";

function parsePort(value: string | undefined): number {
  if (value === undefined) return 43_821;
  if (!/^\d+$/.test(value)) throw new Error("SKETCHUP_BRIDGE_PORT must be an integer");
  const port = Number(value);
  if (port < 0 || port > 65_535) throw new Error("SKETCHUP_BRIDGE_PORT must be between 0 and 65535");
  return port;
}

const allowedOrigins = (process.env.SKETCHUP_BRIDGE_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const bridge = await startBridge({
  port: parsePort(process.env.SKETCHUP_BRIDGE_PORT),
  allowedOrigins,
});

process.stdout.write(`${JSON.stringify({
  event: "sketchup_bridge.started",
  url: bridge.url,
  token: bridge.token,
  allowedOrigins,
})}\n`);

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`${JSON.stringify({ event: "sketchup_bridge.stopping", signal })}\n`);
  await bridge.close();
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
