import sharp from "sharp";
import { boundsOf, type FloorPlanDocument } from "@/lib/floorplan/document";
import { PROPOSAL_SCENE_IDS } from "@/lib/rendering/ingest-scene-png";

const W = 1280;
const H = 720;

function esc(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wallPaths(doc: FloorPlanDocument, bounds: ReturnType<typeof boundsOf>, pad: number) {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const ox = pad + (W - pad * 2 - spanX * scale) / 2;
  const oy = pad + (H - pad * 2 - spanY * scale) / 2;
  const toPx = (p: { xMm: number; yMm: number }) => ({
    x: ox + (p.xMm - bounds.minX) * scale,
    y: oy + (p.yMm - bounds.minY) * scale,
  });

  const paths = doc.walls
    .map((wall) => {
      const a = toPx(wall.start);
      const b = toPx(wall.end);
      const stroke = wall.wallType === "EXTERIOR" ? 10 : 6;
      const color = wall.wallType === "EXTERIOR" ? "#4a5d56" : "#8aa39a";
      return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${color}" stroke-width="${stroke}" stroke-linecap="square"/>`;
    })
    .join("");

  return { paths, toPx, scale, ox, oy, bounds };
}

function isoBox(
  x: number,
  y: number,
  w: number,
  d: number,
  h: number,
  fill: string,
  label?: string,
) {
  const iso = (px: number, py: number, pz: number) => ({
    x: x + (px - py) * 0.55,
    y: y - pz * 0.45 + (px + py) * 0.28,
  });
  const p1 = iso(0, 0, h);
  const p2 = iso(w, 0, h);
  const p3 = iso(w, d, h);
  const p4 = iso(0, d, h);
  const b1 = iso(0, 0, 0);
  const b2 = iso(w, 0, 0);
  const b3 = iso(w, d, 0);
  const b4 = iso(0, d, 0);
  const top = `M${p1.x},${p1.y} L${p2.x},${p2.y} L${p3.x},${p3.y} L${p4.x},${p4.y} Z`;
  const left = `M${p1.x},${p1.y} L${p4.x},${p4.y} L${b4.x},${b4.y} L${b1.x},${b1.y} Z`;
  const right = `M${p2.x},${p2.y} L${p3.x},${p3.y} L${b3.x},${b3.y} L${b2.x},${b2.y} Z`;
  const labelSvg = label
    ? `<text x="${(p1.x + p3.x) / 2}" y="${(p1.y + p3.y) / 2 + 20}" text-anchor="middle" font-size="18" fill="#17342d" font-family="Arial,sans-serif">${esc(label)}</text>`
    : "";
  return `<path d="${top}" fill="${fill}" opacity="0.95"/><path d="${left}" fill="${fill}" opacity="0.75"/><path d="${right}" fill="${fill}" opacity="0.85"/>${labelSvg}`;
}

function svgForScene(doc: FloorPlanDocument, sceneId: string, referenceDataUri?: string) {
  const bounds = boundsOf(doc);
  const { paths } = wallPaths(doc, bounds, 80);
  const title = esc(sceneId);
  const subtitle = esc(`${doc.floorPlanCode} · ${doc.geometryVersion} · concept`);

  if (sceneId === "plan" || sceneId === "dimensioned-plan") {
    const ref = referenceDataUri
      ? `<image href="${referenceDataUri}" x="40" y="40" width="${W - 80}" height="${H - 80}" opacity="0.22" preserveAspectRatio="xMidYMid meet"/>`
      : "";
    const dims =
      sceneId === "dimensioned-plan"
        ? `<text x="80" y="${H - 48}" font-size="22" fill="#1d4ed8" font-family="Arial,sans-serif">${Math.round(bounds.maxX - bounds.minX)} mm</text>
           <text x="${W - 120}" y="120" font-size="22" fill="#1d4ed8" font-family="Arial,sans-serif" transform="rotate(90 ${W - 120} 120)">${Math.round(bounds.maxY - bounds.minY)} mm</text>`
        : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect width="100%" height="100%" fill="#f8faf9"/>
      ${ref}
      <g>${paths}</g>
      ${dims}
      <text x="48" y="52" font-size="28" fill="#134e4a" font-family="Arial,sans-serif">${title}</text>
      <text x="48" y="84" font-size="16" fill="#5b716c" font-family="Arial,sans-serif">${subtitle}</text>
    </svg>`;
  }

  if (sceneId === "aerial") {
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    const baseX = W * 0.22;
    const baseY = H * 0.72;
    const scale = Math.min(0.0009, 520 / Math.max(spanX, spanY));
    const boxes = doc.rooms.length
      ? doc.rooms.map((room, i) => {
          const xs = room.polygon.map((p) => p.xMm);
          const ys = room.polygon.map((p) => p.yMm);
          const rw = (Math.max(...xs) - Math.min(...xs)) * scale;
          const rd = (Math.max(...ys) - Math.min(...ys)) * scale;
          const rx = baseX + (Math.min(...xs) - bounds.minX) * scale;
          const ry = baseY - (Math.min(...ys) - bounds.minY) * scale;
          const colors = ["#d9cfc0", "#c8ddd4", "#e2d3bd", "#cfd8e4"];
          return isoBox(rx, ry, rw, rd, 42, colors[i % colors.length], room.name);
        })
      : [isoBox(baseX, baseY, spanX * scale, spanY * scale, 48, "#d9cfc0", "全屋")];
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#edf4f1"/><stop offset="100%" stop-color="#f7f3ea"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      ${boxes.join("")}
      <text x="48" y="52" font-size="28" fill="#134e4a" font-family="Arial,sans-serif">${title}</text>
      <text x="48" y="84" font-size="16" fill="#5b716c" font-family="Arial,sans-serif">${subtitle}</text>
    </svg>`;
  }

  const roomLabels: Record<string, string> = {
    living: "客厅",
    master: "主卧",
    second: "次卧",
    kitchen: "厨房",
    bath: "浴室",
  };
  const label = roomLabels[sceneId] ?? sceneId;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f3efe8"/><stop offset="100%" stop-color="#e7ece9"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="120" y="120" width="1040" height="480" fill="#faf8f4" stroke="#cad2ce"/>
    <text x="640" y="300" text-anchor="middle" font-size="42" fill="#134e4a" font-family="Arial,sans-serif">${esc(label)}</text>
    <text x="640" y="360" text-anchor="middle" font-size="18" fill="#5b716c" font-family="Arial,sans-serif">概念视角 · 可在场景编辑中换材质/摆商品</text>
    <text x="48" y="52" font-size="28" fill="#134e4a" font-family="Arial,sans-serif">${title}</text>
    <text x="48" y="84" font-size="16" fill="#5b716c" font-family="Arial,sans-serif">${subtitle}</text>
  </svg>`;
}

export async function generateConceptPngs(
  doc: FloorPlanDocument,
  sceneIds: readonly string[] = PROPOSAL_SCENE_IDS,
  referenceBytes?: Buffer,
) {
  const referenceDataUri = referenceBytes
    ? `data:image/png;base64,${referenceBytes.toString("base64")}`
    : undefined;

  const outputs: Array<{ sceneId: string; bytes: Buffer }> = [];
  for (const sceneId of sceneIds) {
    const svg = svgForScene(
      doc,
      sceneId,
      sceneId === "plan" || sceneId === "dimensioned-plan" ? referenceDataUri : undefined,
    );
    const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
    outputs.push({ sceneId, bytes });
  }
  return outputs;
}
