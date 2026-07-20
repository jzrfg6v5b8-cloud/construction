import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { validateSpaceConfiguration } from "@sharkflows/space-schema";
import {
  InMemoryTaskStore,
  StoreError,
  TASK_STATUSES,
  type TaskError,
  type TaskStatus,
  type TaskUpdate,
} from "./task-store.js";

export interface BridgeOptions {
  port?: number;
  allowedOrigins?: readonly string[];
  store?: InMemoryTaskStore;
  requestBodyLimitBytes?: number;
}

export interface RunningBridge {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly token: string;
  readonly url: string;
  readonly store: InMemoryTaskStore;
  close(): Promise<void>;
}

interface JsonObject {
  [key: string]: unknown;
}

export class SketchUpBridge {
  readonly host = "127.0.0.1" as const;
  readonly token: string;
  readonly store: InMemoryTaskStore;

  private readonly port: number;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly requestBodyLimitBytes: number;
  private server: Server | undefined;
  private timeoutSweep: NodeJS.Timeout | undefined;

  constructor(options: BridgeOptions = {}) {
    this.port = options.port ?? 0;
    this.token = randomBytes(32).toString("base64url");
    this.allowedOrigins = new Set(options.allowedOrigins ?? []);
    this.store = options.store ?? new InMemoryTaskStore();
    this.requestBodyLimitBytes = options.requestBodyLimitBytes ?? Math.max(2 * 1024 * 1024, Math.ceil(this.store.maxResultBytes * 1.4));
  }

  async start(): Promise<RunningBridge> {
    if (this.server) throw new Error("Bridge is already running");
    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.port, this.host);
    });

    const address = server.address() as AddressInfo;
    this.timeoutSweep = setInterval(
      () => this.store.sweepTimeouts(),
      Math.min(1_000, Math.max(100, Math.floor(this.store.queueTimeoutMs / 2))),
    );
    this.timeoutSweep.unref();
    return {
      host: this.host,
      port: address.port,
      token: this.token,
      url: `http://${this.host}:${address.port}`,
      store: this.store,
      close: () => this.close(),
    };
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (this.timeoutSweep) {
      clearInterval(this.timeoutSweep);
      this.timeoutSweep = undefined;
    }
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      this.applySecurityHeaders(response);
      const origin = this.checkOrigin(request);
      if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
      if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
        response.setHeader("Access-Control-Max-Age", "600");
        response.end();
        return;
      }
      this.authorize(request);

      const url = new URL(request.url ?? "/", `http://${this.host}`);
      const remoteAddress = request.socket.remoteAddress;

      if (request.method === "GET" && url.pathname === "/health") {
        this.json(response, 200, { ok: true });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/status") {
        this.json(response, 200, {
          connected: true,
          bridgeVersion: "0.1.0",
          host: this.host,
          pendingTasks: this.store.list().filter((task) => task.status !== "COMPLETED" && task.status !== "FAILED").length,
          security: "loopback-and-bearer-token",
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/tasks") {
        const body = await this.readJson(request, 2 * 1024 * 1024);
        const configuration = body.configuration;
        if (!isObject(configuration) || Array.isArray(configuration)) {
          throw new HttpError("INVALID_CONFIGURATION", "configuration must be a JSON object", 400);
        }
        const validation = validateSpaceConfiguration(configuration);
        if (!validation.success) {
          throw new HttpError("INVALID_CONFIGURATION", "configuration does not match SpaceConfiguration", 400);
        }
        const idempotencyKey = this.singleHeader(request, "idempotency-key");
        const result = this.store.create(validation.data, idempotencyKey, remoteAddress);
        this.json(response, result.created ? 201 : 200, result.task);
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/plugin/tasks/next") {
        const waitMs = parseBoundedInteger(url.searchParams.get("waitMs"), 0, this.store.longPollMaxMs, this.store.longPollMaxMs);
        const abort = new AbortController();
        response.once("close", () => abort.abort());
        const task = await this.store.claimNext(waitMs, abort.signal, remoteAddress);
        if (!task) {
          response.statusCode = 204;
          response.end();
        } else {
          this.json(response, 200, task);
        }
        return;
      }

      const taskMatch = /^\/v1\/tasks\/([0-9a-f-]+)$/i.exec(url.pathname);
      if (request.method === "GET" && taskMatch?.[1]) {
        this.json(response, 200, this.store.get(taskMatch[1]));
        return;
      }
      const updateMatch = /^\/v1\/plugin\/tasks\/([0-9a-f-]+)$/i.exec(url.pathname);
      if (request.method === "PATCH" && updateMatch?.[1]) {
        const body = await this.readJson(request, 256 * 1024);
        const update = parseTaskUpdate(body);
        this.json(response, 200, this.store.update(updateMatch[1], update, remoteAddress));
        return;
      }
      const uploadMatch = /^\/v1\/plugin\/tasks\/([0-9a-f-]+)\/result$/i.exec(url.pathname);
      if (request.method === "POST" && uploadMatch?.[1]) {
        const body = await this.readJson(request, this.requestBodyLimitBytes);
        const filename = requireString(body.filename, "filename");
        const contentType = requireString(body.contentType, "contentType");
        const dataBase64 = requireString(body.dataBase64, "dataBase64");
        if (body.final !== undefined && typeof body.final !== "boolean") {
          throw new HttpError("INVALID_FINAL_FLAG", "final must be a boolean", 400);
        }
        if (!isCanonicalBase64(dataBase64)) throw new HttpError("INVALID_BASE64", "dataBase64 must be canonical base64", 400);
        const bytes = Buffer.from(dataBase64, "base64");
        const resultInput = {
          filename,
          contentType,
          bytes,
          ...(typeof body.final === "boolean" ? { final: body.final } : {}),
        };
        this.json(response, 201, this.store.saveResult(uploadMatch[1], resultInput, remoteAddress));
        return;
      }
      const specificResultMatch = /^\/v1\/tasks\/([0-9a-f-]+)\/results\/([0-9a-f-]+)$/i.exec(url.pathname);
      if (request.method === "GET" && specificResultMatch?.[1] && specificResultMatch[2]) {
        this.sendResult(response, this.store.getResult(specificResultMatch[1], specificResultMatch[2]));
        return;
      }
      const resultMatch = /^\/v1\/tasks\/([0-9a-f-]+)\/result$/i.exec(url.pathname);
      if (request.method === "GET" && resultMatch?.[1]) {
        this.sendResult(response, this.store.getResult(resultMatch[1]));
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/audit") {
        this.json(response, 200, { events: this.store.listAudit() });
        return;
      }
      throw new HttpError("NOT_FOUND", "Route not found", 404);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const known = error instanceof StoreError || error instanceof HttpError;
      const status = known ? error.statusCode : 500;
      const code = known ? error.code : "INTERNAL_ERROR";
      const message = known ? error.message : "Internal server error";
      this.json(response, status, { error: { code, message } });
    }
  }

  private checkOrigin(request: IncomingMessage): string | undefined {
    const origin = request.headers.origin;
    if (Array.isArray(origin)) throw new HttpError("INVALID_ORIGIN", "Multiple Origin values are not allowed", 403);
    if (origin === undefined) return undefined;
    if (!this.allowedOrigins.has(origin)) throw new HttpError("ORIGIN_FORBIDDEN", "Origin is not allowed", 403);
    return origin;
  }

  private authorize(request: IncomingMessage): void {
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      throw new HttpError("UNAUTHORIZED", "Bearer authorization is required", 401);
    }
    const actual = Buffer.from(header.slice(7));
    const expected = Buffer.from(this.token);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new HttpError("UNAUTHORIZED", "Invalid bearer token", 401);
    }
  }

  private singleHeader(request: IncomingMessage, name: string): string {
    const value = request.headers[name];
    if (typeof value !== "string") throw new HttpError("MISSING_HEADER", `${name} header is required`, 400);
    return value;
  }

  private async readJson(request: IncomingMessage, limit: number): Promise<JsonObject> {
    const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw new HttpError("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json", 415);
    const declaredLength = Number(request.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > limit) throw new HttpError("BODY_TOO_LARGE", "Request body is too large", 413);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > limit) throw new HttpError("BODY_TOO_LARGE", "Request body is too large", 413);
      chunks.push(bytes);
    }
    try {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!isObject(parsed) || Array.isArray(parsed)) throw new Error("not object");
      return parsed;
    } catch {
      throw new HttpError("INVALID_JSON", "Request body must be a JSON object", 400);
    }
  }

  private applySecurityHeaders(response: ServerResponse): void {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'none'");
  }

  private sendResult(response: ServerResponse, result: ReturnType<InMemoryTaskStore["getResult"]>): void {
    response.statusCode = 200;
    response.setHeader("Content-Type", result.metadata.contentType);
    response.setHeader("Content-Length", result.bytes.length);
    response.setHeader("Digest", `sha-256=${Buffer.from(result.metadata.sha256, "hex").toString("base64")}`);
    response.setHeader("Content-Disposition", contentDisposition(result.metadata.filename));
    response.end(result.bytes);
  }

  private json(response: ServerResponse, statusCode: number, body: unknown): void {
    const bytes = Buffer.from(JSON.stringify(body));
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Content-Length", bytes.length);
    response.end(bytes);
  }
}

class HttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object";
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new HttpError("INVALID_FIELD", `${name} must be a non-empty string`, 400);
  return value;
}

function parseTaskUpdate(body: JsonObject): TaskUpdate {
  const update: TaskUpdate = {};
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !TASK_STATUSES.includes(body.status as TaskStatus)) {
      throw new HttpError("INVALID_STATUS", "Unknown task status", 400);
    }
    update.status = body.status as TaskStatus;
  }
  if (body.progress !== undefined) {
    if (typeof body.progress !== "number") throw new HttpError("INVALID_PROGRESS", "progress must be a number", 400);
    update.progress = body.progress;
  }
  if (body.error !== undefined) {
    if (body.error === null) {
      update.error = null;
    } else if (
      isObject(body.error) &&
      typeof body.error.code === "string" &&
      typeof body.error.message === "string" &&
      typeof body.error.retryable === "boolean"
    ) {
      const taskError: TaskError = {
        code: body.error.code,
        message: body.error.message,
        retryable: body.error.retryable,
      };
      if (isObject(body.error.details)) taskError.details = body.error.details;
      update.error = taskError;
    } else {
      throw new HttpError("INVALID_ERROR", "error must include code, message, and retryable", 400);
    }
  }
  if (body.versions !== undefined) {
    if (!isObject(body.versions) || Object.values(body.versions).some((value) => typeof value !== "string")) {
      throw new HttpError("INVALID_VERSIONS", "versions values must be strings", 400);
    }
    update.versions = body.versions;
  }
  if (body.components !== undefined) {
    if (!isObject(body.components)) throw new HttpError("INVALID_COMPONENTS", "components must be an object", 400);
    update.components = body.components;
  }
  if (Object.keys(update).length === 0) throw new HttpError("EMPTY_UPDATE", "At least one update field is required", 400);
  return update;
}

function parseBoundedInteger(value: string | null, min: number, max: number, fallback: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new HttpError("INVALID_WAIT", "waitMs must be an integer", 400);
  const parsed = Number(value);
  if (parsed < min || parsed > max) throw new HttpError("INVALID_WAIT", `waitMs must be between ${min} and ${max}`, 400);
  return parsed;
}

function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }
  return Buffer.from(value, "base64").toString("base64") === value;
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function startBridge(options: BridgeOptions = {}): Promise<RunningBridge> {
  return new SketchUpBridge(options).start();
}
