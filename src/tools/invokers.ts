import {
  interviewPackAgent,
  jobScoutAgent,
  resumeStrategistAgent,
  tailoredResumeAgent,
} from "../subagents.js";
import {
  ApprovalCardInterrupt,
  ApprovalCardInterruptSchema,
  ArtifactSlot,
  BinaryConfirmationResumeSchema,
  InterviewPackOutput,
  InterviewPackOutputSchema,
  JobScoutReport,
  JobScoutReportSchema,
  MissionState,
  ResumeStrategyOutput,
  ResumeStrategyOutputSchema,
  TailoredResumeOutput,
  TailoredResumeOutputSchema,
} from "../types.js";
import {
  createArtifactSlot,
  requireJdText,
  requireResumeContext,
  requireStructuredResponse,
} from "./shared.js";
import { interrupt } from "@langchain/langgraph";

// 拼装岗位分析 agent 的用户消息，把 JD 和额外说明组织成稳定上下文。
function buildJobScoutMessage(params: {
  jdText: string;
  userInstruction?: string;
}): string {
  return [
    `JD：\n${params.jdText}`,
    params.userInstruction?.trim()
      ? `补充要求：${params.userInstruction.trim()}`
      : undefined,
  ]
    .filter((block): block is string => Boolean(block))
    .join("\n\n");
}

// 调用岗位分析子 agent，并强制按结构化 schema 校验返回结果。
export async function invokeJobScoutAgent(params: {
  jdText: string;
  userInstruction?: string;
}): Promise<JobScoutReport> {
  const rawResult = await jobScoutAgent.invoke({
    messages: [
      {
        role: "user",
        content: buildJobScoutMessage(params),
      },
    ],
  });

  return requireStructuredResponse({
    value: rawResult.structuredResponse,
    schema: JobScoutReportSchema,
    agentName: "job_scout_agent",
  });
}

const HUMAN_CONFIRM_APPROVAL_VALUES = new Set([
  "true",
  "yes",
  "y",
  "ok",
  "approve",
  "approved",
  "confirm",
  "confirmed",
  "继续",
  "继续使用",
  "确认",
  "同意",
  "通过",
]);

const HUMAN_CONFIRM_REJECTION_VALUES = new Set([
  "false",
  "no",
  "n",
  "reject",
  "rejected",
  "cancel",
  "stop",
  "不同意",
  "拒绝",
  "不继续",
  "终止",
]);

function extractMarkdownPreviewItems(markdown: string, limit: number): string[] {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .map((line) =>
      line
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, limit);
}

function extractArtifactNotesWithPrefix(
  slot: ArtifactSlot,
  prefix: string,
): string[] {
  return slot.notes
    .filter((note) => note.startsWith(prefix))
    .map((note) => note.slice(prefix.length).trim())
    .filter(Boolean);
}

function getJobAnalysisSummaryFromSlot(slot: ArtifactSlot): string | undefined {
  const fromNotes = slot.notes.find((note) => !note.startsWith("风险："));
  if (fromNotes?.trim()) {
    return fromNotes.trim();
  }

  return extractMarkdownPreviewItems(slot.markdown, 1)[0];
}

function reconstructResumeStrategyFromSlot(
  slot: ArtifactSlot,
): ResumeStrategyOutput {
  return {
    markdown: slot.markdown,
    missingFacts: extractArtifactNotesWithPrefix(slot, "待补充："),
    assumptions: extractArtifactNotesWithPrefix(slot, "假设："),
  };
}

export function isTailoredResumeDirectionConfirmationCurrent(params: {
  confirmation?: MissionState["tailoredResumeDirectionConfirmation"];
  jobAnalysisHash: string;
  resumeStrategyHash: string;
}): boolean {
  return Boolean(
    params.confirmation?.approvedAt &&
      params.confirmation.jobAnalysisHash === params.jobAnalysisHash &&
      params.confirmation.resumeStrategyHash === params.resumeStrategyHash,
  );
}

export function getTailoredResumeDirectionContext(state: MissionState): {
  jobAnalysisSlot: ArtifactSlot;
  resumeStrategySlot: ArtifactSlot;
  jobAnalysisSummary?: string;
  strategy: ResumeStrategyOutput;
} {
  const jobAnalysisSlot = state.artifacts.jobAnalysis;
  const resumeStrategySlot = state.artifacts.resumeStrategy;

  if (!jobAnalysisSlot || !resumeStrategySlot) {
    throw new Error(
      "还没有可用于确认定制方向的岗位分析或简历策略，请先补齐上游产物。",
    );
  }

  return {
    jobAnalysisSlot,
    resumeStrategySlot,
    jobAnalysisSummary: getJobAnalysisSummaryFromSlot(jobAnalysisSlot),
    strategy: reconstructResumeStrategyFromSlot(resumeStrategySlot),
  };
}

// approval_card 是当前默认的二元 HITL 协议，前端应按标题、摘要、分区和按钮来渲染。
export function buildApprovalCardInterrupt(params: {
  kind: string;
  title: string;
  summary: string;
  sections?: Array<{
    title: string;
    items: string[];
  }>;
  question?: string;
  approveLabel?: string;
  rejectLabel?: string;
  metadata?: Record<string, unknown>;
}): ApprovalCardInterrupt {
  return ApprovalCardInterruptSchema.parse({
    version: 1,
    kind: params.kind,
    ui: "approval_card",
    title: params.title,
    summary: params.summary,
    sections: params.sections ?? [],
    question: params.question,
    options: [
      { id: "approve", label: params.approveLabel?.trim() || "是" },
      { id: "reject", label: params.rejectLabel?.trim() || "否" },
    ],
    metadata: params.metadata,
  });
}

// 将 LangGraph resume value 统一解释成“用户是否明确确认继续”。
export function parseBinaryConfirmationDecision(
  value: unknown,
): boolean | undefined {
  const genericStructuredResume = BinaryConfirmationResumeSchema.safeParse(value);
  if (genericStructuredResume.success) {
    return genericStructuredResume.data.approved;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (HUMAN_CONFIRM_APPROVAL_VALUES.has(normalized)) {
      return true;
    }
    if (HUMAN_CONFIRM_REJECTION_VALUES.has(normalized)) {
      return false;
    }
    return undefined;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (typeof record.approved === "boolean") {
      return record.approved;
    }

    if (typeof record.confirmed === "boolean") {
      return record.confirmed;
    }

    if (record.decisionId === "approve") {
      return true;
    }

    if (record.decisionId === "reject") {
      return false;
    }

    if (typeof record.action === "string") {
      return parseBinaryConfirmationDecision(record.action);
    }

    if (typeof record.value === "string" || typeof record.value === "boolean") {
      return parseBinaryConfirmationDecision(record.value);
    }
  }

  return undefined;
}

// 触发 approval_card，并在恢复后解析出是否确认继续。
export function interruptWithApprovalCard(params: {
  kind: string;
  title: string;
  summary: string;
  sections?: Array<{
    title: string;
    items: string[];
  }>;
  question?: string;
  approveLabel?: string;
  rejectLabel?: string;
  metadata?: Record<string, unknown>;
}): boolean {
  const resumeValue = interrupt(buildApprovalCardInterrupt(params));
  const approved = parseBinaryConfirmationDecision(resumeValue);

  if (approved === undefined) {
    throw new Error("未能从 approval_card 的 resume 值中解析出明确结果。");
  }

  return approved;
}

// 保留旧测试工具名，但底层协议统一迁移到 approval_card，方便前端只维护一套按钮卡片渲染器。
export function interruptWithSimpleBinaryConfirmation(params: {
  kind: string;
  title: string;
  content: string;
  approveLabel?: string;
  rejectLabel?: string;
  metadata?: Record<string, unknown>;
}): boolean {
  return interruptWithApprovalCard({
    kind: params.kind,
    title: params.title,
    summary: params.content,
    approveLabel: params.approveLabel,
    rejectLabel: params.rejectLabel,
    metadata: params.metadata,
  });
}

// 在真正生成 tailoredResume 之前固定弹出“确认定制方向”卡片，确保 HITL 出现在用户可感知的位置。
export function buildTailoredResumeDirectionApprovalInterrupt(params: {
  jobAnalysisSummary?: string;
  resumeStrategyMarkdown: string;
  missingFacts: string[];
  assumptions: string[];
  sourceTool?: string;
}): ApprovalCardInterrupt {
  const strategyHighlights = extractMarkdownPreviewItems(
    params.resumeStrategyMarkdown,
    4,
  );
  const sections = [
    params.jobAnalysisSummary?.trim()
      ? {
          title: "岗位判断",
          items: [params.jobAnalysisSummary.trim()],
        }
      : undefined,
    strategyHighlights.length
      ? {
          title: "当前定制方向",
          items: strategyHighlights,
        }
      : undefined,
    params.assumptions.length
      ? {
          title: "当前假设",
          items: params.assumptions.slice(0, 2),
        }
      : undefined,
    params.missingFacts.length
      ? {
          title: "仍待确认的信息",
          items: params.missingFacts.slice(0, 3),
        }
      : undefined,
  ].filter(
    (
      section,
    ): section is {
      title: string;
      items: string[];
    } => Boolean(section),
  );

  return buildApprovalCardInterrupt({
    kind: "tailored_resume_direction_confirmation",
    title: "确认定制方向",
    summary:
      "岗位分析和简历策略已经准备好。确认后，系统会按当前方向生成定制简历。",
    sections,
    question: "是否按这个方向继续生成定制简历？",
    approveLabel: "继续生成",
    rejectLabel: "我想调整方向",
    metadata: {
      targetArtifactType: "tailoredResume",
      sourceTool: params.sourceTool ?? "confirm_tailored_resume_direction",
    },
  });
}

// 统一走“确认定制方向”卡片；只有用户明确同意后，才允许继续生成 tailoredResume。
export function interruptForTailoredResumeDirectionConfirmation(params: {
  jobAnalysisSummary?: string;
  resumeStrategyMarkdown: string;
  missingFacts: string[];
  assumptions: string[];
  sourceTool?: string;
}): boolean {
  const resumeValue = interrupt(
    buildTailoredResumeDirectionApprovalInterrupt(params),
  );
  const approved = parseBinaryConfirmationDecision(resumeValue);
  if (approved === undefined) {
    throw new Error("未能从确认定制方向卡片的 resume 值中解析出明确结果。");
  }
  return approved;
}

export type PreparedJobAnalysisResult = {
  artifacts: MissionState["artifacts"];
  reviews: MissionState["reviews"];
  jobAnalysisSlot: ArtifactSlot;
  jobAnalysisStatus: "generated" | "reused";
  jobAnalysisSummary?: string;
};

// 统一补齐并沉淀岗位分析；默认流程不再自动审查 jobAnalysis，manual critic 改由主 agent 在需要时显式调用。
export async function prepareJobAnalysisArtifact(params: {
  state: MissionState;
  jobAnalysisInstruction?: string;
  refresh?: boolean;
}): Promise<PreparedJobAnalysisResult> {
  const jdText = requireJdText(params.state);
  const artifacts = {
    ...params.state.artifacts,
  };
  const reviews = {
    ...params.state.reviews,
  };

  let jobAnalysisSlot = artifacts.jobAnalysis;
  let jobAnalysisStatus: "generated" | "reused" = "reused";
  let jobAnalysisSummary: string | undefined;

  if (!jobAnalysisSlot || params.refresh) {
    const report = await invokeJobScoutAgent({
      jdText,
      userInstruction: params.jobAnalysisInstruction,
    });

    const nextJobAnalysis = createArtifactSlot({
      markdown: report.markdown,
      sourceAgent: "job_scout_agent",
      notes: [report.summary, ...report.risks.map((risk) => `风险：${risk}`)],
    });

    artifacts.jobAnalysis = nextJobAnalysis.slot;
    jobAnalysisSlot = nextJobAnalysis.slot;
    jobAnalysisStatus = "generated";
    jobAnalysisSummary = report.summary;
  }

  if (!jobAnalysisSlot) {
    throw new Error("岗位分析仍不可用，无法继续后续流程。");
  }

  return {
    artifacts,
    reviews,
    jobAnalysisSlot,
    jobAnalysisStatus,
    jobAnalysisSummary,
  };
}

// 拼装简历策略 agent 的输入上下文，把 JD、岗位分析和基础简历统一传入。
function buildResumeStrategyMessage(params: {
  jdText: string;
  jobAnalysis: string;
  resumeContext: string;
  userInstruction?: string;
}): string {
  return [
    `JD：\n${params.jdText}`,
    `岗位分析：\n${params.jobAnalysis}`,
    params.resumeContext,
    params.userInstruction?.trim()
      ? `补充要求：${params.userInstruction.trim()}`
      : undefined,
  ]
    .filter((block): block is string => Boolean(block))
    .join("\n\n");
}

// 调用简历策略子 agent，并确保返回值满足策略输出 schema。
export async function invokeResumeStrategistAgent(params: {
  jdText: string;
  jobAnalysis: string;
  resumeContext: string;
  userInstruction?: string;
}): Promise<ResumeStrategyOutput> {
  const rawResult = await resumeStrategistAgent.invoke({
    messages: [
      {
        role: "user",
        content: buildResumeStrategyMessage(params),
      },
    ],
  });

  return requireStructuredResponse({
    value: rawResult.structuredResponse,
    schema: ResumeStrategyOutputSchema,
    agentName: "resume_strategist_agent",
  });
}

// 拼装定制简历 agent 的输入上下文，把所有上游产物和补充要求合并成单次请求。
function buildTailoredResumeMessage(params: {
  jdText: string;
  jobAnalysis: string;
  resumeStrategy: string;
  resumeContext: string;
  userInstruction?: string;
}): string {
  return [
    `JD：\n${params.jdText}`,
    `岗位分析：\n${params.jobAnalysis}`,
    `简历策略：\n${params.resumeStrategy}`,
    params.resumeContext,
    params.userInstruction?.trim()
      ? `补充要求：${params.userInstruction.trim()}`
      : undefined,
  ]
    .filter((block): block is string => Boolean(block))
    .join("\n\n");
}

// 调用定制简历子 agent，并确保结构化结果可直接进入状态沉淀。
export async function invokeTailoredResumeAgent(params: {
  jdText: string;
  jobAnalysis: string;
  resumeStrategy: string;
  resumeContext: string;
  userInstruction?: string;
}): Promise<TailoredResumeOutput> {
  const rawResult = await tailoredResumeAgent.invoke({
    messages: [
      {
        role: "user",
        content: buildTailoredResumeMessage(params),
      },
    ],
  });

  return requireStructuredResponse({
    value: rawResult.structuredResponse,
    schema: TailoredResumeOutputSchema,
    agentName: "tailored_resume_agent",
  });
}

// 拼装面试包 agent 的输入上下文，重点提供岗位信息、策略取舍和最终定制简历内容。
function buildInterviewPackMessage(params: {
  jdText: string;
  jobAnalysis: string;
  resumeStrategy: string;
  tailoredResumeMarkdown: string;
  tailoredResumeJson?: string;
  userInstruction?: string;
}): string {
  return [
    `JD：\n${params.jdText}`,
    `岗位分析：\n${params.jobAnalysis}`,
    `简历策略：\n${params.resumeStrategy}`,
    `定制简历（Markdown）：\n${params.tailoredResumeMarkdown}`,
    params.tailoredResumeJson?.trim()
      ? `定制简历（结构化 JSON）：\n${params.tailoredResumeJson}`
      : undefined,
    params.userInstruction?.trim()
      ? `补充要求：${params.userInstruction.trim()}`
      : undefined,
  ]
    .filter((block): block is string => Boolean(block))
    .join("\n\n");
}

// 调用面试包子 agent，并确保结构化结果可直接进入状态沉淀。
export async function invokeInterviewPackAgent(params: {
  jdText: string;
  jobAnalysis: string;
  resumeStrategy: string;
  tailoredResumeMarkdown: string;
  tailoredResumeJson?: string;
  userInstruction?: string;
}): Promise<InterviewPackOutput> {
  const rawResult = await interviewPackAgent.invoke({
    messages: [
      {
        role: "user",
        content: buildInterviewPackMessage(params),
      },
    ],
  });

  return requireStructuredResponse({
    value: rawResult.structuredResponse,
    schema: InterviewPackOutputSchema,
    agentName: "interview_pack_agent",
  });
}

export type PreparedResumeStrategyResult = {
  artifacts: MissionState["artifacts"];
  reviews: MissionState["reviews"];
  jobAnalysisSlot: ArtifactSlot;
  resumeStrategySlot: ArtifactSlot;
  jobAnalysisStatus: "generated" | "reused";
  resumeStrategyStatus: "generated" | "reused";
  jobAnalysisSummary?: string;
  strategy: ResumeStrategyOutput;
};

export type PreparedTailoredResumeResult = {
  artifacts: MissionState["artifacts"];
  reviews: MissionState["reviews"];
  jobAnalysisSlot: ArtifactSlot;
  resumeStrategySlot: ArtifactSlot;
  tailoredResumeSlot: ArtifactSlot;
  jobAnalysisStatus: "generated" | "reused";
  resumeStrategyStatus: "generated" | "reused";
  tailoredResumeStatus: "generated" | "reused";
  jobAnalysisSummary?: string;
  strategy: ResumeStrategyOutput;
  tailored: TailoredResumeOutput;
};

// 统一补齐并沉淀“岗位分析 -> 简历策略”前置链路，供多个工作流复用。
export async function prepareResumeStrategyArtifacts(params: {
  state: MissionState;
  strategyInstruction?: string;
  jobAnalysisInstruction?: string;
  refreshJobAnalysis?: boolean;
  refreshResumeStrategy?: boolean;
}): Promise<PreparedResumeStrategyResult> {
  const jdText = requireJdText(params.state);
  const resumeContext = requireResumeContext(params.state);
  const preparedJobAnalysis = await prepareJobAnalysisArtifact({
    state: params.state,
    jobAnalysisInstruction: params.jobAnalysisInstruction,
    refresh: params.refreshJobAnalysis,
  });

  const artifacts = {
    ...preparedJobAnalysis.artifacts,
  };
  let resumeStrategySlot = artifacts.resumeStrategy;
  let resumeStrategyStatus: "generated" | "reused" = "reused";
  let strategy: ResumeStrategyOutput;

  const shouldRegenerateStrategy =
    !resumeStrategySlot ||
    params.refreshResumeStrategy ||
    preparedJobAnalysis.jobAnalysisStatus === "generated";

  if (shouldRegenerateStrategy) {
    strategy = await invokeResumeStrategistAgent({
      jdText,
      jobAnalysis: preparedJobAnalysis.jobAnalysisSlot.markdown,
      resumeContext,
      userInstruction: params.strategyInstruction,
    });

    const nextResumeStrategy = createArtifactSlot({
      markdown: strategy.markdown,
      sourceAgent: "resume_strategist_agent",
      notes: [
        ...strategy.missingFacts.map((item) => `待补充：${item}`),
        ...strategy.assumptions.map((item) => `假设：${item}`),
      ],
    });

    artifacts.resumeStrategy = nextResumeStrategy.slot;
    resumeStrategySlot = nextResumeStrategy.slot;
    resumeStrategyStatus = "generated";
  } else if (resumeStrategySlot) {
    strategy = reconstructResumeStrategyFromSlot(resumeStrategySlot);
  } else {
    throw new Error("简历策略复用失败：缺少正式 artifact。");
  }

  return {
    artifacts,
    reviews: preparedJobAnalysis.reviews,
    jobAnalysisSlot: preparedJobAnalysis.jobAnalysisSlot,
    resumeStrategySlot,
    jobAnalysisStatus: preparedJobAnalysis.jobAnalysisStatus,
    resumeStrategyStatus,
    jobAnalysisSummary: preparedJobAnalysis.jobAnalysisSummary,
    strategy,
  };
}

// 统一补齐并沉淀“岗位分析 -> 简历策略 -> 定制简历”链路，供面试包等下游工作流复用。
export async function prepareTailoredResumeArtifacts(params: {
  state: MissionState;
  preparedStrategy?: PreparedResumeStrategyResult;
  resumeInstruction?: string;
  strategyInstruction?: string;
  jobAnalysisInstruction?: string;
  refreshJobAnalysis?: boolean;
  refreshResumeStrategy?: boolean;
  refreshTailoredResume?: boolean;
}): Promise<PreparedTailoredResumeResult> {
  const jdText = requireJdText(params.state);
  const resumeContext = requireResumeContext(params.state);

  let artifacts = {
    ...params.state.artifacts,
  };
  let reviews = {
    ...params.state.reviews,
  };
  let jobAnalysisSlot: ArtifactSlot;
  let resumeStrategySlot: ArtifactSlot;
  let jobAnalysisStatus: "generated" | "reused";
  let resumeStrategyStatus: "generated" | "reused";
  let jobAnalysisSummary: string | undefined;
  let strategy: ResumeStrategyOutput;

  if (params.preparedStrategy) {
    artifacts = params.preparedStrategy.artifacts;
    reviews = params.preparedStrategy.reviews;
    jobAnalysisSlot = params.preparedStrategy.jobAnalysisSlot;
    resumeStrategySlot = params.preparedStrategy.resumeStrategySlot;
    jobAnalysisStatus = params.preparedStrategy.jobAnalysisStatus;
    resumeStrategyStatus = params.preparedStrategy.resumeStrategyStatus;
    jobAnalysisSummary = params.preparedStrategy.jobAnalysisSummary;
    strategy = params.preparedStrategy.strategy;
  } else if (
    !artifacts.jobAnalysis ||
    !artifacts.resumeStrategy ||
    params.refreshJobAnalysis ||
    params.refreshResumeStrategy
  ) {
    const prepared = await prepareResumeStrategyArtifacts({
      state: {
        ...params.state,
        artifacts,
      },
      strategyInstruction: params.strategyInstruction,
      jobAnalysisInstruction: params.jobAnalysisInstruction,
      refreshJobAnalysis: params.refreshJobAnalysis,
      refreshResumeStrategy: params.refreshResumeStrategy,
    });

    artifacts = prepared.artifacts;
    reviews = prepared.reviews;
    jobAnalysisSlot = prepared.jobAnalysisSlot;
    resumeStrategySlot = prepared.resumeStrategySlot;
    jobAnalysisStatus = prepared.jobAnalysisStatus;
    resumeStrategyStatus = prepared.resumeStrategyStatus;
    jobAnalysisSummary = prepared.jobAnalysisSummary;
    strategy = prepared.strategy;
  } else {
    jobAnalysisSlot = artifacts.jobAnalysis;
    resumeStrategySlot = artifacts.resumeStrategy;
    jobAnalysisStatus = "reused";
    resumeStrategyStatus = "reused";
    jobAnalysisSummary = getJobAnalysisSummaryFromSlot(jobAnalysisSlot);
    strategy = reconstructResumeStrategyFromSlot(resumeStrategySlot);
  }

  const shouldRegenerateTailored =
    params.refreshTailoredResume ||
    jobAnalysisStatus === "generated" ||
    resumeStrategyStatus === "generated" ||
    !artifacts.tailoredResume ||
    !params.state.tailoredResume;

  let tailoredResumeSlot = artifacts.tailoredResume;
  let tailoredResumeStatus: "generated" | "reused" = "reused";
  let tailored: TailoredResumeOutput;

  if (shouldRegenerateTailored) {
    tailored = await invokeTailoredResumeAgent({
      jdText,
      jobAnalysis: jobAnalysisSlot.markdown,
      resumeStrategy: resumeStrategySlot.markdown,
      resumeContext,
      userInstruction: params.resumeInstruction,
    });

    const nextTailoredResume = createArtifactSlot({
      markdown: tailored.markdown,
      sourceAgent: "tailored_resume_agent",
      notes: [
        ...tailored.changeSummary.map((item) => `优化：${item}`),
        ...tailored.resume.warnings.map((item) => `注意：${item}`),
        ...tailored.resume.missingFacts.map((item) => `待确认：${item}`),
      ],
    });

    artifacts.tailoredResume = nextTailoredResume.slot;
    tailoredResumeSlot = nextTailoredResume.slot;
    tailoredResumeStatus = "generated";
  } else {
    const reusedTailoredResume = params.state.tailoredResume;
    const reusedTailoredResumeSlot = artifacts.tailoredResume;
    if (!reusedTailoredResume || !reusedTailoredResumeSlot) {
      throw new Error("定制简历复用失败：缺少结构化 state 或正式 artifact。");
    }

    tailored = {
      resume: reusedTailoredResume,
      markdown: reusedTailoredResumeSlot.markdown,
      changeSummary: [],
    };
  }

  if (!tailoredResumeSlot) {
    throw new Error("定制简历仍不可用，无法继续复用或生成下游产物。");
  }

  return {
    artifacts,
    reviews,
    jobAnalysisSlot,
    resumeStrategySlot,
    tailoredResumeSlot,
    jobAnalysisStatus,
    resumeStrategyStatus,
    tailoredResumeStatus,
    jobAnalysisSummary,
    strategy,
    tailored,
  };
}
