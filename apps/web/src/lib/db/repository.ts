import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb, type SharkflowsDb } from "./client";
import {
  accounts,
  approvals,
  assets,
  processingJobs,
  quoteSignatures,
  renderArtifacts,
  sessions,
  stripeEvents,
  subscriptions,
  users,
  type AccountRow,
  type ApprovalRow,
  type AssetRow,
  type ProcessingJobRow,
  type QuoteSignatureRow,
  type RenderArtifactRow,
  type SessionRow,
  type StripeEventRow,
  type SubscriptionRow,
  type UserRow,
} from "./schema";

function nowIso(): string {
  return new Date().toISOString();
}

function dbOrDefault(db?: SharkflowsDb): SharkflowsDb {
  return db ?? getDb().db;
}

export async function upsertUser(
  input: {
    id?: string;
    email: string;
    name?: string | null;
    image?: string | null;
    passwordHash?: string | null;
    plan?: string;
  },
  db?: SharkflowsDb,
): Promise<UserRow> {
  const handle = dbOrDefault(db);
  const existing = await handle.query.users.findFirst({
    where: eq(users.email, input.email),
  });
  const timestamp = nowIso();
  if (existing) {
    const [row] = await handle
      .update(users)
      .set({
        name: input.name ?? existing.name,
        image: input.image ?? existing.image,
        passwordHash: input.passwordHash ?? existing.passwordHash,
        plan: input.plan ?? existing.plan,
        updatedAt: timestamp,
      })
      .where(eq(users.id, existing.id))
      .returning();
    return row!;
  }

  const [row] = await handle
    .insert(users)
    .values({
      id: input.id ?? `usr_${randomUUID()}`,
      email: input.email,
      name: input.name ?? null,
      image: input.image ?? null,
      passwordHash: input.passwordHash ?? null,
      plan: input.plan ?? "free",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  return row!;
}

export async function getUserByEmail(email: string, db?: SharkflowsDb): Promise<UserRow | undefined> {
  return dbOrDefault(db).query.users.findFirst({ where: eq(users.email, email) });
}

export async function createSession(
  input: { userId: string; sessionToken: string; expiresAt: string; id?: string },
  db?: SharkflowsDb,
): Promise<SessionRow> {
  const [row] = await dbOrDefault(db)
    .insert(sessions)
    .values({
      id: input.id ?? `ses_${randomUUID()}`,
      userId: input.userId,
      sessionToken: input.sessionToken,
      expiresAt: input.expiresAt,
      createdAt: nowIso(),
    })
    .returning();
  return row!;
}

export async function getSessionByToken(
  sessionToken: string,
  db?: SharkflowsDb,
): Promise<SessionRow | undefined> {
  return dbOrDefault(db).query.sessions.findFirst({
    where: eq(sessions.sessionToken, sessionToken),
  });
}

export async function linkAccount(
  input: {
    userId: string;
    provider: string;
    providerAccountId: string;
    accessToken?: string | null;
    refreshToken?: string | null;
    expiresAt?: number | null;
  },
  db?: SharkflowsDb,
): Promise<AccountRow> {
  const [row] = await dbOrDefault(db)
    .insert(accounts)
    .values({
      id: `acc_${randomUUID()}`,
      userId: input.userId,
      provider: input.provider,
      providerAccountId: input.providerAccountId,
      accessToken: input.accessToken ?? null,
      refreshToken: input.refreshToken ?? null,
      expiresAt: input.expiresAt ?? null,
      createdAt: nowIso(),
    })
    .returning();
  return row!;
}

export async function upsertSubscription(
  input: {
    id?: string;
    userId: string;
    plan: string;
    status: string;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    currentPeriodEnd?: string | null;
  },
  db?: SharkflowsDb,
): Promise<SubscriptionRow> {
  const handle = dbOrDefault(db);
  const existing = input.stripeSubscriptionId
    ? await handle.query.subscriptions.findFirst({
        where: eq(subscriptions.stripeSubscriptionId, input.stripeSubscriptionId),
      })
    : undefined;
  const timestamp = nowIso();

  if (existing) {
    const [row] = await handle
      .update(subscriptions)
      .set({
        plan: input.plan,
        status: input.status,
        stripeCustomerId: input.stripeCustomerId ?? existing.stripeCustomerId,
        currentPeriodEnd: input.currentPeriodEnd ?? existing.currentPeriodEnd,
        updatedAt: timestamp,
      })
      .where(eq(subscriptions.id, existing.id))
      .returning();
    return row!;
  }

  const [row] = await handle
    .insert(subscriptions)
    .values({
      id: input.id ?? `sub_${randomUUID()}`,
      userId: input.userId,
      plan: input.plan,
      status: input.status,
      stripeCustomerId: input.stripeCustomerId ?? null,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  return row!;
}

export async function recordStripeEvent(
  input: { stripeEventId: string; type: string; payload: unknown; processedAt?: string | null },
  db?: SharkflowsDb,
): Promise<StripeEventRow> {
  const handle = dbOrDefault(db);
  const existing = await handle.query.stripeEvents.findFirst({
    where: eq(stripeEvents.stripeEventId, input.stripeEventId),
  });
  if (existing) return existing;

  const [row] = await handle
    .insert(stripeEvents)
    .values({
      id: `evt_${randomUUID()}`,
      stripeEventId: input.stripeEventId,
      type: input.type,
      payloadJson: JSON.stringify(input.payload),
      processedAt: input.processedAt ?? null,
      createdAt: nowIso(),
    })
    .returning();
  return row!;
}

export async function saveAsset(
  input: Omit<AssetRow, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string },
  db?: SharkflowsDb,
): Promise<AssetRow> {
  const timestamp = nowIso();
  const [row] = await dbOrDefault(db)
    .insert(assets)
    .values({
      ...input,
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp,
    })
    .onConflictDoUpdate({
      target: assets.id,
      set: {
        ...input,
        updatedAt: timestamp,
      },
    })
    .returning();
  return row!;
}

export async function getAsset(id: string, db?: SharkflowsDb): Promise<AssetRow | undefined> {
  return dbOrDefault(db).query.assets.findFirst({ where: eq(assets.id, id) });
}

export async function listAssetsByProject(projectId: string, db?: SharkflowsDb): Promise<AssetRow[]> {
  return dbOrDefault(db).query.assets.findMany({ where: eq(assets.projectId, projectId) });
}

export async function upsertProcessingJob(
  input: Omit<ProcessingJobRow, "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
  },
  db?: SharkflowsDb,
): Promise<ProcessingJobRow> {
  const handle = dbOrDefault(db);
  const existing = await handle.query.processingJobs.findFirst({
    where: eq(processingJobs.jobId, input.jobId),
  });
  const timestamp = nowIso();
  if (existing) {
    const [row] = await handle
      .update(processingJobs)
      .set({ ...input, updatedAt: timestamp })
      .where(eq(processingJobs.id, existing.id))
      .returning();
    return row!;
  }
  const [row] = await handle
    .insert(processingJobs)
    .values({
      ...input,
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp,
    })
    .returning();
  return row!;
}

export async function listProcessingJobsByBatch(
  batchId: string,
  db?: SharkflowsDb,
): Promise<ProcessingJobRow[]> {
  return dbOrDefault(db).query.processingJobs.findMany({
    where: eq(processingJobs.batchId, batchId),
  });
}

export async function saveApproval(
  input: Omit<ApprovalRow, "createdAt"> & { createdAt?: string },
  db?: SharkflowsDb,
): Promise<ApprovalRow> {
  const [row] = await dbOrDefault(db)
    .insert(approvals)
    .values({
      ...input,
      createdAt: input.createdAt ?? nowIso(),
    })
    .returning();
  return row!;
}

export async function listApprovalsByProject(
  projectId: string,
  db?: SharkflowsDb,
): Promise<ApprovalRow[]> {
  return dbOrDefault(db).query.approvals.findMany({ where: eq(approvals.projectId, projectId) });
}

export async function saveQuoteSignature(
  input: Omit<QuoteSignatureRow, "createdAt"> & { createdAt?: string },
  db?: SharkflowsDb,
): Promise<QuoteSignatureRow> {
  const [row] = await dbOrDefault(db)
    .insert(quoteSignatures)
    .values({
      ...input,
      createdAt: input.createdAt ?? nowIso(),
    })
    .returning();
  return row!;
}

export async function saveRenderArtifact(
  input: Omit<RenderArtifactRow, "createdAt"> & { createdAt?: string },
  db?: SharkflowsDb,
): Promise<RenderArtifactRow> {
  const handle = dbOrDefault(db);
  const existing = await handle.query.renderArtifacts.findFirst({
    where: and(
      eq(renderArtifacts.projectId, input.projectId),
      eq(renderArtifacts.renderId, input.renderId),
    ),
  });
  if (existing) {
    const [row] = await handle
      .update(renderArtifacts)
      .set(input)
      .where(eq(renderArtifacts.id, existing.id))
      .returning();
    return row!;
  }
  const [row] = await handle
    .insert(renderArtifacts)
    .values({
      ...input,
      createdAt: input.createdAt ?? nowIso(),
    })
    .returning();
  return row!;
}

export async function listRenderArtifactsByProject(
  projectId: string,
  db?: SharkflowsDb,
): Promise<RenderArtifactRow[]> {
  return dbOrDefault(db).query.renderArtifacts.findMany({
    where: eq(renderArtifacts.projectId, projectId),
  });
}
