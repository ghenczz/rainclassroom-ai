import { parse } from "opentype.js";
import referenceIndexData from "./font-reference-index.json";

interface ReferenceCandidate {
  readonly char: string;
  readonly points: readonly number[];
}

type ReferenceEntry = string | ReferenceCandidate[] | Array<[string, number[]]>;

interface FontReferenceIndex {
  readonly version: number;
  readonly entries: Readonly<Record<string, ReferenceEntry>>;
}

interface PathCommand {
  readonly type: string;
  readonly x?: number;
  readonly y?: number;
  readonly x1?: number;
  readonly y1?: number;
  readonly x2?: number;
  readonly y2?: number;
}

interface OpentypeGlyph {
  readonly path: {
    readonly commands: readonly PathCommand[];
  };
}

interface OpentypeFont {
  readonly tables: {
    readonly cmap?: {
      readonly glyphIndexMap?: Record<string, number>;
    };
  };
  readonly glyphs: {
    get(index: number): OpentypeGlyph | null;
  };
}

const ALLOWED_FONT_HOST = "fe-static-yuketang.yuketang.cn";
const FONT_PATH_PATTERN =
  /^\/fe_font\/product\/exam_font_[a-f0-9]{16,64}\.ttf$/;
const MAX_FONT_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_CACHE_ENTRIES = 20;

const referenceIndex = referenceIndexData as unknown as FontReferenceIndex;
const mappingCache = new Map<string, Readonly<Record<string, string>>>();
const pendingRequests = new Map<
  string,
  Promise<Readonly<Record<string, string>>>
>();

function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }

  return hash.toString(16).padStart(16, "0");
}

function glyphStructure(glyph: OpentypeGlyph): string {
  return glyph.path.commands.map((command) => command.type).join("");
}

function glyphPoints(glyph: OpentypeGlyph): number[] {
  const points: Array<[number, number]> = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const command of glyph.path.commands) {
    let pairs: Array<[number, number]> = [];

    if (command.type === "M" || command.type === "L") {
      if (command.x !== undefined && command.y !== undefined) {
        pairs = [[command.x, command.y]];
      }
    } else if (command.type === "Q") {
      if (
        command.x1 !== undefined &&
        command.y1 !== undefined &&
        command.x !== undefined &&
        command.y !== undefined
      ) {
        pairs = [
          [command.x1, command.y1],
          [command.x, command.y]
        ];
      }
    } else if (command.type === "C") {
      if (
        command.x1 !== undefined &&
        command.y1 !== undefined &&
        command.x2 !== undefined &&
        command.y2 !== undefined &&
        command.x !== undefined &&
        command.y !== undefined
      ) {
        pairs = [
          [command.x1, command.y1],
          [command.x2, command.y2],
          [command.x, command.y]
        ];
      }
    }

    for (const [x, y] of pairs) {
      points.push([x, y]);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  if (points.length === 0) {
    return [];
  }

  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);

  return points.flatMap(([x, y]) => [
    Math.round(((x - minX) / width) * 1000) / 1000,
    Math.round(((y - minY) / height) * 1000) / 1000
  ]);
}

function pointDistance(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return 10;
  }

  let total = 0;

  for (let index = 0; index < left.length; index += 2) {
    const dx = (left[index] ?? 0) - (right[index] ?? 0);
    const dy = (left[index + 1] ?? 0) - (right[index + 1] ?? 0);
    total += dx * dx + dy * dy;
  }

  return Math.sqrt(total / (left.length / 2));
}

function selectCharacter(
  entry: ReferenceEntry,
  targetPoints: readonly number[]
): string | null {
  if (typeof entry === "string") {
    return entry;
  }

  let best: { char: string; distance: number } | null = null;

  for (const candidate of entry) {
    const char = Array.isArray(candidate)
      ? candidate[0]
      : candidate.char;
    const points = Array.isArray(candidate)
      ? candidate[1]
      : candidate.points;
    const distance = pointDistance(targetPoints, points);

    if (!best || distance < best.distance) {
      best = { char, distance };
    }
  }

  return best?.char ?? null;
}

export function decodeFontBuffer(
  buffer: ArrayBuffer
): Readonly<Record<string, string>> {
  const font = parse(buffer) as unknown as OpentypeFont;
  const glyphIndexMap = font.tables.cmap?.glyphIndexMap;

  if (!glyphIndexMap) {
    throw new Error("字体缺少 cmap 映射。");
  }

  const mapping: Record<string, string> = {};
  const decodedByGlyph = new Map<number, string | null>();

  for (const [codepointText, glyphIndex] of Object.entries(glyphIndexMap)) {
    const codepoint = Number(codepointText);

    if (!Number.isInteger(codepoint) || codepoint < 0) {
      continue;
    }

    let decoded = decodedByGlyph.get(glyphIndex);

    if (decoded === undefined) {
      const glyph = font.glyphs.get(glyphIndex);

      if (!glyph || glyph.path.commands.length === 0) {
        decoded = null;
      } else {
        const key = fnv1a64(glyphStructure(glyph));
        const entry = referenceIndex.entries[key];

        if (!entry) {
          decoded = null;
        } else {
          decoded = selectCharacter(entry, glyphPoints(glyph));
        }
      }

      decodedByGlyph.set(glyphIndex, decoded);
    }

    if (decoded) {
      mapping[String.fromCodePoint(codepoint)] = decoded;
    }
  }

  return mapping;
}

export function validateFontUrl(fontUrl: string): URL {
  let url: URL;

  try {
    url = new URL(fontUrl);
  } catch {
    throw new Error("题目字体地址格式不正确。");
  }

  if (url.protocol !== "https:" || url.hostname !== ALLOWED_FONT_HOST) {
    throw new Error("题目字体地址不在允许的雨课堂静态资源域名内。");
  }

  if (!FONT_PATH_PATTERN.test(url.pathname)) {
    throw new Error("题目字体路径不符合预期格式。");
  }

  if (url.username || url.password) {
    throw new Error("题目字体地址不能包含认证信息。");
  }

  return url;
}

function rememberMapping(
  cacheKey: string,
  mapping: Readonly<Record<string, string>>
): void {
  if (mappingCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = mappingCache.keys().next().value;

    if (typeof oldestKey === "string") {
      mappingCache.delete(oldestKey);
    }
  }

  mappingCache.set(cacheKey, mapping);
}

async function loadFontMapping(
  fontUrl: string
): Promise<Readonly<Record<string, string>>> {
  const url = validateFontUrl(fontUrl);
  const cacheKey = url.toString();
  const cached = mappingCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const pending = pendingRequests.get(cacheKey);

  if (pending) {
    return pending;
  }

  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(cacheKey, {
        credentials: "omit",
        redirect: "error",
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(
          `下载题目字体失败（HTTP ${response.status}）。`
        );
      }

      const buffer = await response.arrayBuffer();

      if (buffer.byteLength === 0 || buffer.byteLength > MAX_FONT_BYTES) {
        throw new Error("题目字体文件大小异常。");
      }

      const mapping = decodeFontBuffer(buffer);

      if (Object.keys(mapping).length === 0) {
        throw new Error("未能从题目字体中解析出字符映射。");
      }

      rememberMapping(cacheKey, mapping);
      return mapping;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("下载题目字体超时。");
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();

  pendingRequests.set(cacheKey, request);

  try {
    return await request;
  } finally {
    pendingRequests.delete(cacheKey);
  }
}

export async function getFontMappingForUrl(
  fontUrl: string
): Promise<Readonly<Record<string, string>>> {
  return loadFontMapping(fontUrl);
}
