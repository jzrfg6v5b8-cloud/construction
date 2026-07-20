import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import {
  createProject,
  ensureDemoProject,
  getLayoutChecklist,
  getProject,
  saveLayoutChecklist,
  touchProject,
} from "@/lib/db/repositories";

export const runtime = "nodejs";

function ensureProject(projectId: string) {
  if (projectId === "demo") ensureDemoProject();
  else if (!getProject(projectId)) createProject({ id: projectId, name: `项目 ${projectId.slice(0, 8)}` });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  getDb();
  ensureProject(id);
  const checklist = getLayoutChecklist(id);
  return NextResponse.json({
    projectId: id,
    checklist,
    steps: [
      {
        key: "open_template",
        done: Boolean(checklist.open_template),
        title: "打开指定 .layout 模板",
        detail: "使用公司 A3 模板，核对页边距与图签。",
      },
      {
        key: "refresh_and_check",
        done: Boolean(checklist.refresh_and_check),
        title: "刷新 SKP 引用并检查关联尺寸",
        detail: "处理黄色/断开尺寸，确认场景绑定。",
      },
      {
        key: "export_pdf",
        done: Boolean(checklist.export_pdf),
        title: "点击导出 PDF/PNG",
        detail: "目视核对后导出；插件无法代替此步。",
      },
    ],
    layoutAutomation: false,
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  getDb();
  ensureProject(id);
  const body = (await request.json().catch(() => ({}))) as {
    openTemplate?: boolean;
    refreshAndCheck?: boolean;
    exportPdf?: boolean;
    templateCode?: string;
    notes?: string;
    updatedBy?: string;
  };
  const checklist = saveLayoutChecklist({
    projectId: id,
    ...body,
  });
  touchProject(id);
  return NextResponse.json({ ok: true, checklist });
}
