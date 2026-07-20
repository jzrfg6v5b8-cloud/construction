import { z } from "zod";

export const TaskStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);
export const EnqueueTaskInputSchema = z.object({
  type: z.string().min(1),
  idempotencyKey: z.string().min(1),
  payload: z.unknown(),
  maxAttempts: z.number().int().positive().max(20).default(3),
});
export const LocalTaskSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  idempotencyKey: z.string().min(1),
  payload: z.unknown(),
  status: TaskStatusSchema,
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export type EnqueueTaskInput = z.input<typeof EnqueueTaskInputSchema>;
export type LocalTask = z.infer<typeof LocalTaskSchema>;
export type TaskHandler = (payload: unknown, task: Readonly<LocalTask>) => Promise<unknown>;

export interface TaskStore {
  getByIdempotencyKey(key: string): Promise<LocalTask | undefined>;
  get(id: string): Promise<LocalTask | undefined>;
  list(): Promise<LocalTask[]>;
  save(task: LocalTask): Promise<void>;
}

export class InMemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, LocalTask>();
  private readonly keyIndex = new Map<string, string>();

  async getByIdempotencyKey(key: string): Promise<LocalTask | undefined> {
    const id = this.keyIndex.get(key);
    return id ? this.tasks.get(id) : undefined;
  }

  async get(id: string): Promise<LocalTask | undefined> {
    return this.tasks.get(id);
  }

  async list(): Promise<LocalTask[]> {
    return [...this.tasks.values()];
  }

  async save(task: LocalTask): Promise<void> {
    const parsed = LocalTaskSchema.parse(task);
    this.tasks.set(parsed.id, parsed);
    this.keyIndex.set(parsed.idempotencyKey, parsed.id);
  }
}

export class LocalTaskQueue {
  private readonly handlers = new Map<string, TaskHandler>();
  private running = false;
  private sequence = 0;

  constructor(
    private readonly store: TaskStore = new InMemoryTaskStore(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  register(type: string, handler: TaskHandler): void {
    if (!type.trim()) throw new Error("Task type is required");
    if (this.handlers.has(type)) throw new Error(`Handler already registered for ${type}`);
    this.handlers.set(type, handler);
  }

  async enqueue(input: EnqueueTaskInput): Promise<LocalTask> {
    const parsed = EnqueueTaskInputSchema.parse(input);
    const existing = await this.store.getByIdempotencyKey(parsed.idempotencyKey);
    if (existing) return existing;
    const timestamp = this.now().toISOString();
    const task = LocalTaskSchema.parse({
      id: `local-${timestamp}-${++this.sequence}`,
      ...parsed,
      status: "queued",
      attempt: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.store.save(task);
    return task;
  }

  async get(id: string): Promise<LocalTask | undefined> {
    return this.store.get(id);
  }

  async list(): Promise<LocalTask[]> {
    return this.store.list();
  }

  async runNext(): Promise<LocalTask | undefined> {
    if (this.running) return undefined;
    const task = (await this.store.list()).find((item) => item.status === "queued");
    if (!task) return undefined;
    const handler = this.handlers.get(task.type);
    if (!handler) throw new Error(`No handler registered for ${task.type}`);

    this.running = true;
    let current: LocalTask = {
      ...task,
      status: "running",
      attempt: task.attempt + 1,
      updatedAt: this.now().toISOString(),
      error: undefined,
    };
    await this.store.save(current);
    try {
      const result = await handler(current.payload, current);
      current = { ...current, status: "succeeded", result, updatedAt: this.now().toISOString() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      current = {
        ...current,
        status: current.attempt < current.maxAttempts ? "queued" : "failed",
        error: message,
        updatedAt: this.now().toISOString(),
      };
    } finally {
      this.running = false;
    }
    await this.store.save(current);
    return current;
  }

  async drain(): Promise<LocalTask[]> {
    const processed: LocalTask[] = [];
    while (true) {
      const next = await this.runNext();
      if (!next) return processed;
      processed.push(next);
    }
  }
}
