import { access } from "node:fs/promises";
import path from "node:path";

const FALLBACK_FONT_CANDIDATES = [
  process.env.NOTO_CJK_FONT_PATH,
  process.env.CJK_FONT_PATH,
  "/Library/Fonts/Arial Unicode.ttf",
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf",
  "/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf",
  path.join(process.cwd(), "assets/fonts/NotoSansSC-Regular.otf"),
  path.join(process.cwd(), "assets/fonts/NotoSansCJK-Regular.ttf"),
].filter((value): value is string => Boolean(value?.trim()));

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a TrueType/OpenType CJK font for pdf-lib embedding.
 * Prefers explicit options / env, then common OS install paths.
 */
export async function resolveCjkFontPath(explicit?: string): Promise<string> {
  const ordered = [explicit, ...FALLBACK_FONT_CANDIDATES].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  for (const candidate of ordered) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error("NOTO_CJK_FONT_PATH_NOT_CONFIGURED");
}
