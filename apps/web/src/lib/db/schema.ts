import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  passwordHash: text("password_hash"),
  plan: text("plan").notNull().default("free"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sessionToken: text("session_token").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: integer("expires_at"),
  createdAt: text("created_at").notNull(),
});

export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan: text("plan").notNull(),
  status: text("status").notNull(),
  currentPeriodEnd: text("current_period_end"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const stripeEvents = sqliteTable("stripe_events", {
  id: text("id").primaryKey(),
  stripeEventId: text("stripe_event_id").notNull().unique(),
  type: text("type").notNull(),
  payloadJson: text("payload_json").notNull(),
  processedAt: text("processed_at"),
  createdAt: text("created_at").notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  name: text("name").notNull(),
  address: text("address"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  userId: text("user_id"),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  widthPx: integer("width_px"),
  heightPx: integer("height_px"),
  sha256: text("sha256").notNull(),
  storageKey: text("storage_key").notNull(),
  thumbnailKey: text("thumbnail_key"),
  processingStatus: text("processing_status").notNull().default("QUEUED"),
  assetType: text("asset_type").notNull().default("document"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const processingJobs = sqliteTable("processing_jobs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().unique(),
  batchId: text("batch_id").notNull(),
  fileId: text("file_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull(),
  progress: integer("progress").notNull().default(0),
  attemptsMade: integer("attempts_made").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  sourceUrl: text("source_url").notNull(),
  errorJson: text("error_json"),
  resultJson: text("result_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  role: text("role").notNull(),
  decision: text("decision").notNull(),
  actorId: text("actor_id").notNull(),
  sceneVersion: text("scene_version"),
  payloadJson: text("payload_json"),
  createdAt: text("created_at").notNull(),
});

export const quoteSignatures = sqliteTable("quote_signatures", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  provider: text("provider").notNull(),
  documentSha256: text("document_sha256").notNull(),
  signatureId: text("signature_id").notNull(),
  signedBy: text("signed_by").notNull(),
  signedAt: text("signed_at").notNull(),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  stampText: text("stamp_text"),
  createdAt: text("created_at").notNull(),
});

export const renderArtifacts = sqliteTable("render_artifacts", {
  id: text("id").primaryKey(),
  renderId: text("render_id").notNull(),
  projectId: text("project_id").notNull(),
  sceneId: text("scene_id").notNull(),
  sceneVersion: text("scene_version").notNull(),
  renderer: text("renderer").notNull(),
  status: text("status").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  imageUri: text("image_uri"),
  html: text("html"),
  error: text("error"),
  skuCodesJson: text("sku_codes_json").notNull().default("[]"),
  materialCodesJson: text("material_codes_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
});

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type StripeEventRow = typeof stripeEvents.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type ProcessingJobRow = typeof processingJobs.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
export type QuoteSignatureRow = typeof quoteSignatures.$inferSelect;
export type RenderArtifactRow = typeof renderArtifacts.$inferSelect;
