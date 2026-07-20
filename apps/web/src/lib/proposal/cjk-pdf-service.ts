import { readFile } from "node:fs/promises";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import { resolveCjkFontPath } from "./cjk-font";
import type { QuoteSignature } from "./quote-signature-provider";

export type ProposalPdfInput = {
  projectId: string;
  title: string;
  status: "DRAFT" | "FINAL";
  sceneVersion: string;
  scenes: Array<{ title: string; image: Uint8Array; caption?: string; isPlaceholder?: boolean }>;
  bom: Array<{ sku: string; name: string; quantity: number; unitPrice: number; materialCode?: string }>;
  quote: { currency: string; subtotal: number; tax: number; total: number };
  approvals: Array<{ role: string; actorId: string; decision: string; at: string }>;
  signature?: QuoteSignature;
};

export type CJKPdfServiceOptions = {
  fontPath?: string;
  fontkit?: unknown;
};

const PAGE: [number, number] = [842, 595];
const margin = 48;

async function loadFontkit() {
  try {
    const imported = await import("@pdf-lib/fontkit");
    return (imported as { default?: unknown }).default ?? imported;
  } catch {
    throw new Error("FONTKIT_NOT_INSTALLED");
  }
}

function fitText(text: string, font: PDFFont, size: number, maxWidth: number) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && font.widthOfTextAtSize(`${value}…`, size) > maxWidth) value = value.slice(0, -1);
  return `${value}…`;
}

function heading(page: PDFPage, font: PDFFont, title: string, subtitle: string) {
  page.drawText(title, { x: margin, y: PAGE[1] - 58, size: 25, font, color: rgb(0.08, 0.22, 0.18) });
  page.drawText(subtitle, { x: margin, y: PAGE[1] - 82, size: 9, font, color: rgb(0.35, 0.4, 0.37) });
}

export class CJKPdfService {
  constructor(private readonly options: CJKPdfServiceOptions = {}) {}

  async generate(input: ProposalPdfInput): Promise<Uint8Array> {
    const fontPath = await resolveCjkFontPath(this.options.fontPath);
    const [fontBytes, fontkit] = await Promise.all([
      readFile(fontPath),
      this.options.fontkit ? Promise.resolve(this.options.fontkit) : loadFontkit(),
    ]);
    const pdf = await PDFDocument.create();
    (pdf as PDFDocument & { registerFontkit(value: unknown): void }).registerFontkit(fontkit);
    const font = await pdf.embedFont(fontBytes, { subset: true });

    const cover = pdf.addPage(PAGE);
    cover.drawRectangle({ x: 0, y: 0, width: PAGE[0], height: PAGE[1], color: rgb(0.94, 0.93, 0.89) });
    cover.drawText(fitText(input.title, font, 34, PAGE[0] - margin * 2), {
      x: margin, y: 390, size: 34, font, color: rgb(0.07, 0.19, 0.16),
    });
    cover.drawText(`项目 ${input.projectId}  ·  Scene ${input.sceneVersion}`, { x: margin, y: 350, size: 13, font });
    cover.drawText(input.status === "FINAL" ? "FINAL / 已通过发布检查" : "DRAFT / 草稿，不可用于签约", {
      x: margin, y: 80, size: 16, font, color: input.status === "FINAL" ? rgb(0.05, 0.42, 0.28) : rgb(0.72, 0.27, 0.08),
    });
    cover.drawText("场景截图为非照片级结构示意，不代表照片级渲染完成。", {
      x: margin, y: 56, size: 10, font, color: rgb(0.45, 0.4, 0.28),
    });

    for (const scene of input.scenes) {
      const page = pdf.addPage(PAGE);
      heading(page, font, scene.title, `${input.projectId} · ${input.sceneVersion}`);
      const image = scene.image[0] === 0x89
        ? await pdf.embedPng(scene.image)
        : await pdf.embedJpg(scene.image);
      const box = { width: PAGE[0] - margin * 2, height: 410 };
      const scale = Math.min(box.width / image.width, box.height / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      page.drawImage(image, { x: (PAGE[0] - width) / 2, y: 80 + (box.height - height) / 2, width, height });
      const caption = scene.caption
        ?? (scene.isPlaceholder
          ? "非照片级场景占位 · NON-PHOTOREALISTIC PLACEHOLDER"
          : "非照片级场景截图 · NON-PHOTOREALISTIC SCENE CAPTURE");
      page.drawText(fitText(caption, font, 9, box.width), { x: margin, y: 55, size: 9, font });
    }

    const bom = pdf.addPage(PAGE);
    heading(bom, font, "BOM 与报价", `币种 ${input.quote.currency}`);
    let y = 470;
    bom.drawText("SKU / 名称", { x: margin, y, size: 10, font });
    bom.drawText("材质", { x: 400, y, size: 10, font });
    bom.drawText("数量", { x: 590, y, size: 10, font });
    bom.drawText("金额", { x: 690, y, size: 10, font });
    y -= 22;
    for (const line of input.bom) {
      if (y < 85) break;
      bom.drawText(fitText(`${line.sku} / ${line.name}`, font, 9, 330), { x: margin, y, size: 9, font });
      bom.drawText(fitText(line.materialCode ?? "-", font, 9, 170), { x: 400, y, size: 9, font });
      bom.drawText(String(line.quantity), { x: 600, y, size: 9, font });
      bom.drawText((line.quantity * line.unitPrice).toFixed(2), { x: 690, y, size: 9, font });
      y -= 19;
    }
    bom.drawText(`小计 ${input.quote.subtotal.toFixed(2)}   税额 ${input.quote.tax.toFixed(2)}   合计 ${input.quote.total.toFixed(2)}`, {
      x: 470, y: 52, size: 11, font,
    });

    const review = pdf.addPage(PAGE);
    heading(review, font, "覆盖与审核记录", `${input.status} · ${new Date().toISOString()}`);
    y = 460;
    for (const approval of input.approvals) {
      review.drawText(fitText(`${approval.role} · ${approval.actorId} · ${approval.decision} · ${approval.at}`, font, 11, 730), {
        x: margin, y, size: 11, font,
      });
      y -= 28;
    }
    const stamp = input.signature?.stampText
      ?? (input.signature?.verified ? `签章已验证 ${input.signature.signatureId}` : "未提供签章");
    review.drawRectangle({ x: 560, y: 80, width: 220, height: 90, borderWidth: 2, borderColor: rgb(0.7, 0.12, 0.1) });
    review.drawText(fitText(stamp, font, 15, 190), { x: 575, y: 120, size: 15, font, color: rgb(0.7, 0.12, 0.1) });

    pdf.setTitle(`${input.title} - ${input.status}`);
    pdf.setSubject(`Project ${input.projectId}, scene ${input.sceneVersion}`);
    pdf.setProducer("Sharkflows CJKPdfService");
    return pdf.save();
  }
}
