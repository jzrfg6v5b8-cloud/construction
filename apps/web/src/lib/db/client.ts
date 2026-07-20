import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type SharkflowsDb = BetterSQLite3Database<typeof schema>;

export type DbHandle = {
  db: SharkflowsDb;
  sqlite: Database.Database;
  path: string;
};

const globalState = globalThis as typeof globalThis & {
  __sharkflowsDb?: DbHandle;
};

export function resolveDatabasePath(configured = process.env.DATABASE_PATH): string {
  const relative = configured ?? ".data/sharkflows.sqlite";
  return path.isAbsolute(relative) ? relative : path.resolve(process.cwd(), relative);
}

export function ensureSchema(sqlite: Database.Database): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      image TEXT,
      password_hash TEXT,
      plan TEXT NOT NULL DEFAULT 'free',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      expires_at INTEGER,
      created_at TEXT NOT NULL,
      UNIQUE(provider, provider_account_id)
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      plan TEXT NOT NULL,
      status TEXT NOT NULL,
      current_period_end TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stripe_events (
      id TEXT PRIMARY KEY NOT NULL,
      stripe_event_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      processed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT,
      name TEXT NOT NULL,
      address TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS floor_plans (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL UNIQUE,
      geometry_version TEXT NOT NULL,
      dimensions_verified INTEGER NOT NULL DEFAULT 0,
      ceiling_height_mm INTEGER NOT NULL DEFAULT 2800,
      document_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS layout_checklists (
      project_id TEXT PRIMARY KEY NOT NULL,
      open_template INTEGER NOT NULL DEFAULT 0,
      refresh_and_check INTEGER NOT NULL DEFAULT 0,
      export_pdf INTEGER NOT NULL DEFAULT 0,
      template_code TEXT,
      notes TEXT,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS sketchup_results (
      project_id TEXT PRIMARY KEY NOT NULL,
      geometry_version TEXT NOT NULL,
      model_version TEXT NOT NULL,
      status TEXT NOT NULL,
      component_stats_json TEXT NOT NULL DEFAULT '[]',
      exports_json TEXT NOT NULL DEFAULT '[]',
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      user_id TEXT,
      original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      width_px INTEGER,
      height_px INTEGER,
      sha256 TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      thumbnail_key TEXT,
      processing_status TEXT NOT NULL DEFAULT 'QUEUED',
      asset_type TEXT NOT NULL DEFAULT 'document',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processing_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      job_id TEXT NOT NULL UNIQUE,
      batch_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      attempts_made INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      source_url TEXT NOT NULL,
      error_json TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      decision TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      scene_version TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quote_signatures (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      document_sha256 TEXT NOT NULL,
      signature_id TEXT NOT NULL,
      signed_by TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      stamp_text TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS render_artifacts (
      id TEXT PRIMARY KEY NOT NULL,
      render_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      scene_version TEXT NOT NULL,
      renderer TEXT NOT NULL,
      status TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      image_uri TEXT,
      html TEXT,
      error TEXT,
      sku_codes_json TEXT NOT NULL DEFAULT '[]',
      material_codes_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, sku TEXT NOT NULL,
      name TEXT NOT NULL, category TEXT NOT NULL, width_mm REAL, depth_mm REAL, height_mm REAL,
      material_code TEXT, supplier TEXT, unit TEXT NOT NULL DEFAULT 'piece',
      unit_cost REAL NOT NULL DEFAULT 0, unit_price REAL NOT NULL DEFAULT 0,
      dimensions_verified INTEGER NOT NULL DEFAULT 0, source_asset_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, sku)
    );
    CREATE TABLE IF NOT EXISTS bom_items (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, product_id TEXT,
      sku TEXT NOT NULL, name TEXT NOT NULL, quantity REAL NOT NULL,
      unit TEXT NOT NULL, unit_cost REAL NOT NULL, unit_price REAL NOT NULL,
      material_code TEXT, room_code TEXT, source_version TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, version TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'HKD', status TEXT NOT NULL DEFAULT 'DRAFT',
      subtotal REAL NOT NULL, design_fee REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(project_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at);
    CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
    CREATE INDEX IF NOT EXISTS idx_processing_jobs_batch ON processing_jobs(batch_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_project ON approvals(project_id);
    CREATE INDEX IF NOT EXISTS idx_render_artifacts_project ON render_artifacts(project_id);
    CREATE INDEX IF NOT EXISTS idx_floor_plans_project ON floor_plans(project_id);
    CREATE INDEX IF NOT EXISTS idx_products_project ON products(project_id);
    CREATE INDEX IF NOT EXISTS idx_bom_project ON bom_items(project_id);
    CREATE INDEX IF NOT EXISTS idx_quotes_project ON quotes(project_id);
  `);

  // Soft migrations for databases created before asset_type existed.
  const columns = sqlite.prepare("PRAGMA table_info(assets)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "asset_type")) {
    sqlite.exec(`ALTER TABLE assets ADD COLUMN asset_type TEXT NOT NULL DEFAULT 'document'`);
  }
}

export function createDb(dbPath = resolveDatabasePath()): DbHandle {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  ensureSchema(sqlite);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite, path: dbPath };
}

export function getDb(): DbHandle {
  if (!globalState.__sharkflowsDb) {
    globalState.__sharkflowsDb = createDb();
  }
  return globalState.__sharkflowsDb;
}

export function resetDbForTests(dbPath?: string): DbHandle {
  if (globalState.__sharkflowsDb) {
    globalState.__sharkflowsDb.sqlite.close();
    globalState.__sharkflowsDb = undefined;
  }
  globalState.__sharkflowsDb = createDb(dbPath ?? resolveDatabasePath());
  return globalState.__sharkflowsDb;
}

export function closeDb(): void {
  if (!globalState.__sharkflowsDb) return;
  globalState.__sharkflowsDb.sqlite.close();
  globalState.__sharkflowsDb = undefined;
}
