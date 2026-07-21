import type { ModelingTask, TaskUpdate } from "./task-store.js";

export type CloudPollerOptions = {
  cloudUrl: string;
  projectId: string;
  secret: string;
  claimedBy: string;
  pollIntervalMs?: number;
  onLog?: (event: string, details?: Record<string, unknown>) => void;
};

type ClaimResponse = {
  claimed: boolean;
  task?: {
    id: string;
    idempotencyKey: string;
    status: string;
  };
  configuration?: unknown;
};

type LocalBridge = {
  createTask: (configuration: unknown, idempotencyKey: string) => ModelingTask;
  getTask: (id: string) => ModelingTask | null;
  listTasks: () => ModelingTask[];
  getResultBytes: (taskId: string, resultId?: string) => { filename: string; contentType: string; bytes: Buffer } | null;
};

/**
 * Polls Vercel cloud queue and injects claimed tasks into the local loopback bridge store.
 * SketchUp plugin continues talking only to 127.0.0.1.
 */
export class CloudTaskPoller {
  private timer: NodeJS.Timeout | undefined;
  private stopping = false;
  private readonly cloudToLocal = new Map<string, string>();
  private readonly localToCloud = new Map<string, string>();
  private readonly lastSynced = new Map<string, string>();

  constructor(
    private readonly options: CloudPollerOptions,
    private readonly local: LocalBridge,
  ) {}

  start() {
    if (this.timer) return;
    const interval = this.options.pollIntervalMs ?? 2_000;
    const tick = () => {
      void this.loopOnce().catch((error) => {
        this.log("poll_error", { message: error instanceof Error ? error.message : String(error) });
      });
    };
    tick();
    this.timer = setInterval(tick, interval);
    this.timer.unref?.();
    this.log("started", {
      cloudUrl: this.options.cloudUrl,
      projectId: this.options.projectId,
      intervalMs: interval,
    });
  }

  async stop() {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private log(event: string, details?: Record<string, unknown>) {
    this.options.onLog?.(event, details);
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.options.secret}`,
      "Content-Type": "application/json",
    };
  }

  private resultsUrl() {
    return `${this.options.cloudUrl.replace(/\/$/, "")}/api/projects/${this.options.projectId}/sketchup/results`;
  }

  private async loopOnce() {
    if (this.stopping) return;
    await this.claimOnce();
    await this.syncLocalProgress();
  }

  private async claimOnce() {
    const response = await fetch(this.resultsUrl(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ op: "claim", claimedBy: this.options.claimedBy }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`claim HTTP ${response.status}: ${text.slice(0, 160)}`);
    }
    const payload = (await response.json()) as ClaimResponse;
    if (!payload.claimed || !payload.task || !payload.configuration) return;

    const cloudId = payload.task.id;
    if (this.cloudToLocal.has(cloudId)) return;

    const localTask = this.local.createTask(payload.configuration, payload.task.idempotencyKey || cloudId);
    this.cloudToLocal.set(cloudId, localTask.id);
    this.localToCloud.set(localTask.id, cloudId);
    this.log("claimed", { cloudId, localId: localTask.id });
  }

  private async syncLocalProgress() {
    for (const [localId, cloudId] of this.localToCloud) {
      const task = this.local.getTask(localId);
      if (!task) continue;
      const fingerprint = `${task.status}:${task.progress}:${task.results.length}:${task.error?.code ?? ""}`;
      if (this.lastSynced.get(localId) === fingerprint) continue;

      await this.postUpdate(cloudId, {
        status: task.status,
        progress: task.progress,
        error: task.error,
        versions: task.versions,
        components: task.components,
      });

      // Upload PNG results that look like scenes (skip large SKP).
      for (const result of task.results) {
        const isPng =
          result.contentType.includes("png") || result.filename.toLowerCase().endsWith(".png");
        if (!isPng) continue;
        if (result.sizeBytes > 3.5 * 1024 * 1024) {
          this.log("skip_large_png", { filename: result.filename, sizeBytes: result.sizeBytes });
          continue;
        }
        const key = `${localId}:${result.id}`;
        if (this.lastSynced.get(key) === "uploaded") continue;
        const file = this.local.getResultBytes(localId, result.id);
        if (!file) continue;
        await this.postResult(cloudId, task, file, false);
        this.lastSynced.set(key, "uploaded");
      }

      if (task.status === "COMPLETED" || task.status === "FAILED") {
        if (task.status === "COMPLETED") {
          const primary = this.local.getResultBytes(localId);
          if (primary && (primary.contentType.includes("png") || primary.filename.toLowerCase().endsWith(".png"))) {
            await this.postResult(cloudId, task, primary, true);
          } else {
            await this.postUpdate(cloudId, { status: "COMPLETED", progress: 100 });
            await this.postComplete(task);
          }
        }
        this.localToCloud.delete(localId);
        this.cloudToLocal.delete(cloudId);
      }

      this.lastSynced.set(localId, fingerprint);
    }
  }

  private async postUpdate(cloudId: string, update: TaskUpdate & { status?: string; progress?: number }) {
    const response = await fetch(this.resultsUrl(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        op: "update",
        taskId: cloudId,
        status: update.status,
        progress: update.progress,
        error: update.error ?? null,
        versions: update.versions,
        components: update.components,
      }),
    });
    if (!response.ok) {
      throw new Error(`update HTTP ${response.status}`);
    }
  }

  private async postResult(
    cloudId: string,
    task: ModelingTask,
    file: { filename: string; contentType: string; bytes: Buffer },
    final: boolean,
  ) {
    const sceneGuess = file.filename.replace(/\.png$/i, "").toLowerCase().replace(/_/g, "-");
    const geometryVersion =
      typeof (task.configuration as { geometryVersion?: unknown })?.geometryVersion === "string"
        ? (task.configuration as { geometryVersion: string }).geometryVersion
        : task.versions.configurationVersion;
    const response = await fetch(this.resultsUrl(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        op: "result",
        taskId: cloudId,
        filename: file.filename,
        contentType: file.contentType,
        dataBase64: file.bytes.toString("base64"),
        final,
        sceneId: sceneGuess,
        geometryVersion,
        modelVersion: task.versions.pluginVersion ?? `mv-${task.id}`,
        componentStats: [],
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`result HTTP ${response.status}: ${text.slice(0, 160)}`);
    }
    this.log("result_uploaded", { cloudId, filename: file.filename, final });
  }

  private async postComplete(task: ModelingTask) {
    const geometryVersion =
      (task.configuration as { geometryVersion?: string })?.geometryVersion ??
      task.versions.configurationVersion ??
      `gv-${task.id}`;
    const response = await fetch(this.resultsUrl(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        op: "complete",
        projectId: this.options.projectId,
        geometryVersion,
        modelVersion: task.versions.pluginVersion ?? `mv-${task.id}`,
        status: task.status,
        componentStats: [],
        exports: task.results,
      }),
    });
    if (!response.ok) {
      this.log("complete_failed", { status: response.status });
    }
  }
}
