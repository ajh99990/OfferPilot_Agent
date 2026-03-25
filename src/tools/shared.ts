import { ToolMessage } from "@langchain/core/messages";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ArtifactSlot,
  ArtifactType,
  MissionState,
  ReviewTargetArtifactType,
} from "../types.js";

// 统一生成 ISO 时间戳，作为状态更新时间与 artifact 元数据时间来源。
function nowIso(): string {
  return new Date().toISOString();
}

// 对普通文本做最小清洗，去掉多余空白并保留基本段落结构。
export function normalizePlainText(value: string): string {
  const normalizedLineBreaks = value.replace(/\r\n/g, "\n");
  const cleanedLines = normalizedLineBreaks
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim());

  const lines: string[] = [];
  let previousWasBlank = false;

  for (const line of cleanedLines) {
    if (!line) {
      if (!previousWasBlank && lines.length > 0) {
        lines.push("");
      }
      previousWasBlank = true;
      continue;
    }

    lines.push(line);
    previousWasBlank = false;
  }

  while (lines.at(-1) === "") {
    lines.pop();
  }

  return lines.join("\n").trim();
}

// 对 Markdown 做轻量归一化，避免后续 hash 与导出受空行噪声影响。
export function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MAX_RESUME_PDF_BYTES = 10 * 1024 * 1024;

// 从 Content-Disposition 头里尽量提取文件名，兼容普通 filename 和 RFC 5987 写法。
function parseContentDispositionFileName(
  contentDisposition: string | null,
): string | undefined {
  if (!contentDisposition) {
    return undefined;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).trim();
    } catch {
      return utf8Match[1].trim();
    }
  }

  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1]?.trim() || undefined;
}

// 为下载得到的简历推断一个稳定文件名，优先级依次为显式传入、响应头、URL 路径、默认名。
function deriveResumeFileName(url: string, providedFileName?: string): string {
  const candidate = providedFileName?.trim();
  if (candidate) {
    return candidate.toLowerCase().endsWith(".pdf")
      ? candidate
      : `${candidate}.pdf`;
  }

  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (lastSegment) {
      const decoded = decodeURIComponent(lastSegment).trim();
      if (decoded) {
        return decoded.toLowerCase().endsWith(".pdf")
          ? decoded
          : `${decoded}.pdf`;
      }
    }
  } catch {
    // ignore and fall back below
  }

  return "resume.pdf";
}

// 下载远程简历 PDF，并在进入解析链路前完成大小、类型和文件名校验。
export async function downloadResumePdf(params: {
  url: string;
  fileName?: string;
}): Promise<{
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  size: number;
  sourceContentType?: string;
}> {
  const response = await fetch(params.url, {
    headers: {
      Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.1",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`下载简历失败：${response.status} ${response.statusText}`);
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_RESUME_PDF_BYTES) {
    throw new Error(
      `简历 PDF 过大（${declaredLength} bytes），当前仅支持 10MB 以内文件。`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) {
    throw new Error("下载到的简历文件为空。请检查 URL 是否有效。");
  }

  if (bytes.byteLength > MAX_RESUME_PDF_BYTES) {
    throw new Error(
      `简历 PDF 过大（${bytes.byteLength} bytes），当前仅支持 10MB 以内文件。`,
    );
  }

  const headerFileName = parseContentDispositionFileName(
    response.headers.get("content-disposition"),
  );
  const fileName = deriveResumeFileName(
    params.url,
    headerFileName ?? params.fileName,
  );
  const sourceContentType =
    response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() || undefined;
  const mimeType =
    !sourceContentType || sourceContentType === "application/octet-stream"
      ? "application/pdf"
      : sourceContentType;

  const looksLikePdf =
    mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");

  if (!looksLikePdf) {
    throw new Error("当前仅支持 PDF 简历 URL。请提供可访问的 PDF 文件链接。");
  }

  return {
    bytes,
    mimeType,
    fileName,
    size: bytes.byteLength,
    sourceContentType,
  };
}

// 用最小代价判断输入是否更像 URL，供 JD 工具自动推断 sourceType。
export function isProbablyUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// 解码抓取 HTML 时最常见的一批实体，避免正文清洗后出现明显乱码。
function decodeBasicHtmlEntities(html: string): string {
  return html
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

// 把简单网页正文转成纯文本，便于 JD URL 抓取后交给下游 agent 使用。
function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  const withBlockBreaks = withoutScripts
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/section>/gi, "\n")
    .replace(/<\/article>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n");

  const stripped = withBlockBreaks.replace(/<[^>]+>/g, " ");
  return normalizePlainText(decodeBasicHtmlEntities(stripped));
}

// 抓取 JD URL 并尽可能提取可复用的正文文本。
export async function fetchUrlText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`抓取 JD 失败：${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  const text = contentType.includes("html")
    ? htmlToText(body)
    : normalizePlainText(body);

  if (!text) {
    throw new Error("抓取到的页面正文为空，建议改为直接粘贴 JD 文本。");
  }

  return text;
}

// 为正式内容生成内容 hash，便于后续判断产物是否变化。
function createContentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// 对 notes 去重并清理空值，避免 artifact 元数据里堆积重复提示。
function uniqueNotes(notes: string[] | undefined): string[] {
  if (!notes) {
    return [];
  }

  return Array.from(
    new Set(notes.map((note) => note.trim()).filter((note) => note.length > 0)),
  );
}

// 把 markdown 封装成统一的 artifact slot，供审查、导出与状态复用共享同一份元数据结构。
export function createArtifactSlot(params: {
  markdown: string;
  sourceAgent?: string;
  notes?: string[];
}): { slot: ArtifactSlot; updatedAt: string; hash: string } {
  const cleanedMarkdown = normalizeMarkdown(params.markdown);
  if (!cleanedMarkdown) {
    throw new Error("正式产物内容不能为空。");
  }

  const updatedAt = nowIso();
  const hash = createContentHash(cleanedMarkdown);
  const slot: ArtifactSlot = {
    markdown: cleanedMarkdown,
    updatedAt,
    hash,
    sourceAgent: params.sourceAgent?.trim() || undefined,
    notes: uniqueNotes(params.notes),
  };

  return {
    slot,
    updatedAt,
    hash,
  };
}

// 把工具执行结果包装成标准 ToolMessage，方便主 agent 和状态快照统一消费。
export function makeToolMessage(
  name: string,
  toolCallId: string | undefined,
  payload: unknown,
): ToolMessage {
  return new ToolMessage({
    name,
    tool_call_id: toolCallId ?? `${name}-manual`,
    content: JSON.stringify(payload, null, 2),
  });
}

// 读取并校验当前 Mission 中已沉淀的 JD 正文，没有则明确阻断流程。
export function requireJdText(state: MissionState): string {
  const jdText = state.jdText.trim();
  if (!jdText) {
    throw new Error("还没有可用的 JD 正文，请先调用 extract_jd_text。");
  }

  return jdText;
}

// 读取指定正式产物的 Markdown 正文，没有则直接抛错阻断下游流程。
export function requireArtifactMarkdown(
  state: MissionState,
  artifactType: ArtifactType,
): string {
  const artifact = state.artifacts[artifactType];
  if (!artifact) {
    throw new Error(`还没有可用的 ${artifactType} 正式产物，无法继续。`);
  }

  return artifact.markdown;
}

// 读取基础简历正文并转换成给下游 agent 使用的上下文块。
export function requireResumeContext(state: MissionState): string {
  const baseResumeMarkdown = state.baseResumeMarkdown?.trim();

  if (baseResumeMarkdown) {
    return `基础简历 Markdown：\n${baseResumeMarkdown}`;
  }

  throw new Error(
    "还没有可用的基础简历正文，无法继续简历相关流程。请先调用 ingest_resume_from_url。",
  );
}

// 对子 agent 的 structuredResponse 做统一 schema 校验，避免脏数据写入状态。
export function requireStructuredResponse<T>(params: {
  value: unknown;
  schema: z.ZodType<T>;
  agentName: string;
}): T {
  const parsed = params.schema.safeParse(params.value);
  if (!parsed.success) {
    throw new Error(
      `${params.agentName} 返回的 structuredResponse 不符合 schema：${parsed.error.message}`,
    );
  }

  return parsed.data;
}

// 为 critic agent 组装审查上下文，只提供目标产物及其必要上游依赖。
export function buildCriticContext(
  state: MissionState,
  targetArtifactType: ReviewTargetArtifactType,
): string {
  const blocks = [`目标产物：${targetArtifactType}`];

  blocks.push(`JD：\n${requireJdText(state)}`);
  blocks.push(
    `待审查正文：\n${requireArtifactMarkdown(state, targetArtifactType)}`,
  );

  if (targetArtifactType === "resumeStrategy") {
    blocks.push(`岗位分析：\n${requireArtifactMarkdown(state, "jobAnalysis")}`);
    blocks.push(requireResumeContext(state));
  }

  if (targetArtifactType === "tailoredResume") {
    blocks.push(`岗位分析：\n${requireArtifactMarkdown(state, "jobAnalysis")}`);
    blocks.push(
      `简历策略：\n${requireArtifactMarkdown(state, "resumeStrategy")}`,
    );
    blocks.push(requireResumeContext(state));
  }

  if (targetArtifactType === "interviewPack") {
    blocks.push(`岗位分析：\n${requireArtifactMarkdown(state, "jobAnalysis")}`);
    blocks.push(
      `简历策略：\n${requireArtifactMarkdown(state, "resumeStrategy")}`,
    );
    blocks.push(
      `定制简历：\n${requireArtifactMarkdown(state, "tailoredResume")}`,
    );
  }

  return blocks.join("\n\n");
}
