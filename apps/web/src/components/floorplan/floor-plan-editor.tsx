"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Check, LoaderCircle, Plus, Save, ShieldCheck } from "lucide-react";
import {
  boundsOf,
  createStarterFloorPlan,
  newWallId,
  type EditableWall,
  type FloorPlanDocument,
  toSpaceConfigurationDraft,
} from "@/lib/floorplan/document";
import { buttonPrimary, buttonSecondary, StatusPill } from "@/components/ui";

type FloorPlanEditorProps = {
  projectId: string;
};

export function FloorPlanEditor({ projectId }: FloorPlanEditorProps) {
  const [doc, setDoc] = useState<FloorPlanDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [draftStart, setDraftStart] = useState<{ xMm: number; yMm: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/floorplan`)
      .then((r) => r.json())
      .then((payload: { document?: FloorPlanDocument }) => {
        if (!cancelled) setDoc(payload.document ?? createStarterFloorPlan(projectId));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const bounds = useMemo(() => (doc ? boundsOf(doc) : null), [doc]);
  const pad = 400;
  const viewBox = bounds
    ? `${bounds.minX - pad} ${bounds.minY - pad} ${bounds.maxX - bounds.minX + pad * 2} ${bounds.maxY - bounds.minY + pad * 2}`
    : "0 0 8000 8000";

  const clientToMm = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg || !bounds) return { xMm: 0, yMm: 0 };
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return { xMm: 0, yMm: 0 };
      const local = pt.matrixTransform(ctm.inverse());
      return {
        xMm: Math.round(local.x / 50) * 50,
        yMm: Math.round(local.y / 50) * 50,
      };
    },
    [bounds],
  );

  function onSvgClick(event: MouseEvent<SVGSVGElement>) {
    if (!doc || doc.dimensionsVerified) return;
    const point = clientToMm(event.clientX, event.clientY);
    if (!draftStart) {
      setDraftStart(point);
      setMessage("已选起点，再点一次确定墙终点");
      return;
    }
    const wall: EditableWall = {
      objectId: newWallId(),
      start: draftStart,
      end: point,
      thicknessMm: 120,
      heightMm: doc.ceilingHeightMm,
      wallType: "INTERIOR",
      verificationStatus: "CANDIDATE",
    };
    setDoc({ ...doc, walls: [...doc.walls, wall], dimensionsVerified: false });
    setDraftStart(null);
    setMessage("已添加墙体（候选）");
  }

  async function save(verified?: boolean) {
    if (!doc) return;
    setSaving(true);
    setMessage(null);
    const next = {
      ...doc,
      dimensionsVerified: verified ?? doc.dimensionsVerified,
      geometryVersion: verified ? doc.geometryVersion : `gv-${Date.now().toString(36)}`,
    };
    try {
      const response = await fetch(`/api/projects/${projectId}/floorplan`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document: next }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error ?? "保存失败");
        return;
      }
      setDoc(payload.document);
      setMessage(verified ? "已保存并标记尺寸 VERIFIED" : "户型已保存");
    } finally {
      setSaving(false);
    }
  }

  function resetStarter() {
    setDoc(createStarterFloorPlan(projectId));
    setDraftStart(null);
    setMessage("已载入 6400×7000 起步户型（未审核）");
  }

  function downloadJson() {
    if (!doc) return;
    const blob = new Blob([JSON.stringify(toSpaceConfigurationDraft(doc), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectId}-space-configuration.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading || !doc) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-16 text-sm text-slate-500">
        <LoaderCircle className="animate-spin" size={16} /> 加载户型几何…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className={buttonSecondary} onClick={resetStarter} disabled={doc.dimensionsVerified}>
          载入标准起步户型
        </button>
        <button className={buttonSecondary} onClick={() => void save(false)} disabled={saving}>
          {saving ? <LoaderCircle className="animate-spin" size={14} /> : <Save size={14} />}
          保存草稿
        </button>
        <button className={buttonPrimary} onClick={() => void save(true)} disabled={saving || doc.walls.length === 0}>
          <ShieldCheck size={14} /> 提交设计师核验
        </button>
        <button className={buttonSecondary} onClick={downloadJson}>
          导出 SpaceConfiguration JSON
        </button>
        <StatusPill tone={doc.dimensionsVerified ? "green" : "amber"}>
          {doc.dimensionsVerified ? "尺寸已核验" : "编辑中 / 未核验"}
        </StatusPill>
        {message && <span className="text-xs text-teal-700">{message}</span>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-[#f7f5f0]">
          <svg
            ref={svgRef}
            viewBox={viewBox}
            className="h-[520px] w-full cursor-crosshair"
            onClick={onSvgClick}
            role="img"
            aria-label="户型编辑画布"
          >
            <defs>
              <pattern id="grid" width="500" height="500" patternUnits="userSpaceOnUse">
                <path d="M 500 0 L 0 0 0 500" fill="none" stroke="#e4e0d6" strokeWidth="20" />
              </pattern>
            </defs>
            <rect x={-2000} y={-2000} width={20000} height={20000} fill="url(#grid)" />
            {doc.rooms.map((room) => (
              <polygon
                key={room.objectId}
                points={room.polygon.map((p) => `${p.xMm},${p.yMm}`).join(" ")}
                fill="#d7e8df"
                opacity={0.55}
              />
            ))}
            {doc.walls.map((wall) => (
              <g key={wall.objectId}>
                <line
                  x1={wall.start.xMm}
                  y1={wall.start.yMm}
                  x2={wall.end.xMm}
                  y2={wall.end.yMm}
                  stroke={wall.wallType === "EXTERIOR" ? "#123f35" : "#5b7c72"}
                  strokeWidth={wall.thicknessMm}
                  strokeLinecap="square"
                />
                <title>
                  {wall.wallType} · {Math.round(Math.hypot(wall.end.xMm - wall.start.xMm, wall.end.yMm - wall.start.yMm))} mm ·{" "}
                  {wall.verificationStatus}
                </title>
              </g>
            ))}
            {draftStart && (
              <circle cx={draftStart.xMm} cy={draftStart.yMm} r={60} fill="#cf7a2e" />
            )}
          </svg>
          <p className="border-t border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
            点击画布两点添加内墙（50mm 吸附）。核验后锁定编辑。单位：毫米。
          </p>
        </div>

        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-bold">几何摘要</h3>
          <dl className="mt-3 space-y-2 text-xs text-slate-600">
            <div className="flex justify-between gap-2">
              <dt>墙体</dt>
              <dd className="font-semibold">{doc.walls.length}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>房间</dt>
              <dd className="font-semibold">{doc.rooms.length}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>层高</dt>
              <dd className="font-semibold">{doc.ceilingHeightMm} mm</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>版本</dt>
              <dd className="font-mono text-[10px]">{doc.geometryVersion}</dd>
            </div>
          </dl>
          <ul className="mt-4 max-h-64 space-y-2 overflow-auto text-[11px]">
            {doc.walls.map((wall) => {
              const len = Math.round(
                Math.hypot(wall.end.xMm - wall.start.xMm, wall.end.yMm - wall.start.yMm),
              );
              return (
                <li key={wall.objectId} className="rounded-lg bg-slate-50 px-2 py-1.5">
                  {wall.wallType} · {len}mm · {wall.verificationStatus}
                </li>
              );
            })}
          </ul>
          {!doc.dimensionsVerified && (
            <p className="mt-3 flex items-start gap-1 text-[11px] text-slate-400">
              <Plus size={12} className="mt-0.5" /> 点击画布添加墙体
            </p>
          )}
          {doc.dimensionsVerified && (
            <p className="mt-3 flex items-center gap-1 text-[11px] text-emerald-700">
              <Check size={12} /> 已锁定；如需改墙请新建版本并重新审核
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
