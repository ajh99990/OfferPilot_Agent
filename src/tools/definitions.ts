import { HumanMessage } from "@langchain/core/messages";
import type { ToolRuntime } from "@langchain/core/tools";
import { Command } from "@langchain/langgraph";
import { tool } from "langchain";
import { z } from "zod";
import { criticAgent, resumeIngestAgent } from "../subagents.js";
import {
  ArtifactTypeSchema,
  CriticVerdict,
  CriticVerdictSchema,
  ExtractJdResult,
  ExtractJdResultSchema,
  HumanConfirmationRequest,
  HumanConfirmationRequestSchema,
  InterviewPackOutput,
  MissionState,
  ResumeIngestOutput,
  ResumeIngestOutputSchema,
  ResumeStrategyOutput,
  ReviewTargetArtifactType,
  ReviewTargetArtifactTypeSchema,
  TailoredResumeOutput,
} from "../types.js";
import {
  getTailoredResumeDirectionContext,
  interruptForTailoredResumeDirectionConfirmation,
  interruptWithSimpleBinaryConfirmation,
  isTailoredResumeDirectionConfirmationCurrent,
  invokeInterviewPackAgent,
  prepareJobAnalysisArtifact,
  invokeResumeStrategistAgent,
  invokeTailoredResumeAgent,
  prepareTailoredResumeArtifacts,
  prepareResumeStrategyArtifacts,
} from "./invokers.js";
import {
  buildCriticContext,
  createArtifactSlot,
  downloadResumePdf,
  fetchUrlText,
  isProbablyUrl,
  makeToolMessage,
  normalizeMarkdown,
  normalizePlainText,
  requireJdText,
  requireResumeContext,
  requireStructuredResponse,
} from "./shared.js";

// 获取并清洗 JD 文本，然后把规范化结果写回 Mission state。
export const extractJdText = tool(
  async (
    { source, sourceType },
    runtime: ToolRuntime<MissionState>,
  ): Promise<Command> => {
    const detectedSourceType =
      sourceType ?? (isProbablyUrl(source) ? "url" : "text");
    const jdText =
      detectedSourceType === "url"
        ? await fetchUrlText(source)
        : normalizePlainText(source);

    if (!jdText) {
      throw new Error("JD 文本为空，无法保存规范化后的 JD。");
    }

    const result: ExtractJdResult = ExtractJdResultSchema.parse({
      sourceType: detectedSourceType,
      jdText,
      note:
        detectedSourceType === "url"
          ? "已从 URL 抓取正文并完成最小清洗。"
          : "已接收文本并完成最小清洗。",
    });

    return new Command({
      update: {
        jdSourceType: result.sourceType,
        jdSourceValue: source,
        jdText: result.jdText,
        messages: [
          makeToolMessage("extract_jd_text", runtime.toolCallId, result),
        ],
      },
    });
  },
  {
    name: "extract_jd_text",
    description:
      "获取并最小清洗 JD 文本，然后保存为后续流程可复用的规范化 JD。",
    schema: z.object({
      source: z.string().min(1).describe("JD 文本或 URL。"),
      sourceType: z.enum(["text", "url"]).optional().describe("source 的类型"),
    }),
  },
);

// 下载并解析远程 PDF 简历，把基础简历正文沉淀到 state.baseResumeMarkdown。
export const ingestResumeFromUrl = tool(
  async (
    { url, fileName, userInstruction },
    runtime: ToolRuntime<MissionState>,
  ): Promise<Command> => {
    const pdf = await downloadResumePdf({ url, fileName });
    const base64Pdf = Buffer.from(pdf.bytes).toString("base64");

    // 通过文件 block 把 PDF 原文交给 resume ingest agent，让它直接基于文件做结构化提取。
    const contentBlocks = [
      {
        type: "text" as const,
        text:
          userInstruction?.trim() ||
          "请将这份 PDF 简历忠实整理为 Markdown，保留结构，不要润色，不要补写事实。",
      },
      {
        type: "file" as const,
        data: base64Pdf,
        mimeType: pdf.mimeType,
        metadata: {
          filename: pdf.fileName,
          sourceUrl: url,
        },
      },
    ];

    const rawResult = await resumeIngestAgent.invoke({
      messages: [
        new HumanMessage({
          contentBlocks,
        }),
      ],
    });

    const parsed = requireStructuredResponse({
      value: rawResult.structuredResponse,
      schema: ResumeIngestOutputSchema,
      agentName: "resume_ingest_agent",
    });

    const markdown = normalizeMarkdown(parsed.markdown);
    if (!markdown) {
      throw new Error(
        "resume_ingest_agent 返回的 markdown 为空，无法写入 baseResumeMarkdown。",
      );
    }

    const payload = {
      ok: true,
      chars: markdown.length,
      quality: parsed.quality,
      warnings: parsed.warnings,
      fileName: pdf.fileName,
      mimeType: pdf.mimeType,
      sourceContentType: pdf.sourceContentType,
      size: pdf.size,
    } satisfies Omit<ResumeIngestOutput, "markdown"> & {
      ok: true;
      chars: number;
      fileName: string;
      mimeType: string;
      sourceContentType?: string;
      size: number;
    };

    return new Command({
      update: {
        baseResumeMarkdown: markdown,
        messages: [
          makeToolMessage(
            "ingest_resume_from_url",
            runtime.toolCallId,
            payload,
          ),
        ],
      },
    });
  },
  {
    name: "ingest_resume_from_url",
    description:
      "下载简历 PDF URL，调用 resume_ingest_agent 解析，并保存基础简历正文供后续流程使用。",
    schema: z.object({
      url: z.string().describe("简历 PDF 的可访问 URL。"),
      fileName: z
        .string()
        .optional()
        .describe("可选文件名；若 URL 不含明确文件名，建议显式传入。"),
      userInstruction: z
        .string()
        .optional()
        .describe("给 resume_ingest_agent 的额外解析要求。"),
    }),
  },
);

// 通用测试/流程原语：触发一个 approval_card 版的是/否确认卡片，正文只包含一段纯文本。
export const requestSimpleHumanConfirmation = tool(
  async (
    { kind, title, content, approveLabel, rejectLabel },
    runtime: ToolRuntime<MissionState>,
  ): Promise<Command> => {
    const approved = interruptWithSimpleBinaryConfirmation({
      kind,
      title,
      content,
      approveLabel,
      rejectLabel,
      metadata: {
        toolName: "request_simple_human_confirmation",
      },
    });

    return new Command({
      update: {
        messages: [
          makeToolMessage(
            "request_simple_human_confirmation",
            runtime.toolCallId,
            {
              ok: true,
              kind,
              approved,
              decisionId: approved ? "approve" : "reject",
              title,
            },
          ),
        ],
      },
    });
  },
  {
    name: "request_simple_human_confirmation",
    description:
      "触发一个通用的是/否人工确认卡片。底层协议使用 approval_card，适合做前端联调测试，或在未来流程里复用简单的二元确认。",
    schema: z.object({
      kind: z
        .string()
        .min(1)
        .describe("业务中断类型标识，例如 demo_confirmation、resume_publish_gate。"),
      title: z.string().min(1).describe("卡片标题。"),
      content: z
        .string()
        .min(1)
        .describe("卡片正文内容，只包含一段需要用户判断的文本。"),
      approveLabel: z
        .string()
        .optional()
        .describe("确认按钮文案，默认是“是”。"),
      rejectLabel: z
        .string()
        .optional()
        .describe("拒绝按钮文案，默认是“否”。"),
    }),
  },
);

// 默认工作流：先补齐岗位分析，再生成并沉淀 resumeStrategy。
export const prepareResumeStrategy = tool(
  async (
    {
      strategyInstruction,
      jobAnalysisInstruction,
      refreshJobAnalysis,
      refreshResumeStrategy,
    },
    runtime: ToolRuntime<MissionState>,
  ): Promise<Command> => {
    // 默认工作流只负责把前置产物补齐并沉淀，不暴露中间拼装细节给主 agent。
    const prepared = await prepareResumeStrategyArtifacts({
      state: runtime.state,
      strategyInstruction,
      jobAnalysisInstruction,
      refreshJobAnalysis,
      refreshResumeStrategy,
    });

    const shouldResetDirectionConfirmation =
      prepared.jobAnalysisStatus === "generated" ||
      prepared.resumeStrategyStatus === "generated";
    const artifacts = shouldResetDirectionConfirmation
      ? {
          ...prepared.artifacts,
          tailoredResume: undefined,
          interviewPack: undefined,
        }
      : prepared.artifacts;

    return new Command({
      update: {
        artifacts,
        reviews: prepared.reviews,
        tailoredResume: shouldResetDirectionConfirmation
          ? undefined
          : runtime.state.tailoredResume,
        interviewPack: shouldResetDirectionConfirmation
          ? undefined
          : runtime.state.interviewPack,
        tailoredResumeDirectionConfirmation: shouldResetDirectionConfirmation
          ? {}
          : runtime.state.tailoredResumeDirectionConfirmation,
        messages: [
          makeToolMessage("prepare_resume_strategy", runtime.toolCallId, {
            ok: true,
            jobAnalysisStatus: prepared.jobAnalysisStatus,
            resumeStrategyStatus: prepared.resumeStrategyStatus,
            jobAnalysisUpdatedAt: prepared.jobAnalysisSlot.updatedAt,
            jobAnalysisHash: prepared.jobAnalysisSlot.hash,
            jobAnalysisSummary: prepared.jobAnalysisSummary,
            resumeStrategyUpdatedAt: prepared.resumeStrategySlot.updatedAt,
            resumeStrategyHash: prepared.resumeStrategySlot.hash,
            missingFacts: prepared.strategy.missingFacts,
            assumptions: prepared.strategy.assumptions,
          }),
        ],
      },
    });
  },
  {
    name: "prepare_resume_strategy",
    description:
      "默认工作流：当用户需要简历策略时优先使用。它会先确保岗位分析可用，再生成并保存简历策略。",
    schema: z.object({
      strategyInstruction: z
        .string()
        .optional()
        .describe("给简历策略生成阶段的补充要求。"),
      jobAnalysisInstruction: z
        .string()
        .optional()
        .describe(
          "给岗位分析阶段的补充要求；只有在需要新生成岗位分析时才会使用。",
        ),
      refreshJobAnalysis: z
        .boolean()
        .default(false)
        .describe("是否强制重新生成岗位分析，而不是复用已有结果。"),
      refreshResumeStrategy: z
        .boolean()
        .default(false)
        .describe("是否强制重新生成简历策略，而不是复用已有结果。"),
    }),
  },
);

// 固定 HITL：在真正生成 tailoredResume 之前，先让用户确认当前定制方向。
export const confirmTailoredResumeDirection = tool(
  async (_input, runtime: ToolRuntime<MissionState>): Promise<Command> => {
    const context = getTailoredResumeDirectionContext(runtime.state);
    const alreadyConfirmed = isTailoredResumeDirectionConfirmationCurrent({
      confirmation: runtime.state.tailoredResumeDirectionConfirmation,
      jobAnalysisHash: context.jobAnalysisSlot.hash,
      resumeStrategyHash: context.resumeStrategySlot.hash,
    });

    if (alreadyConfirmed) {
      return new Command({
        update: {
          messages: [
            makeToolMessage(
              "confirm_tailored_resume_direction",
              runtime.toolCallId,
              {
                ok: true,
                confirmationStatus: "reused",
                jobAnalysisHash: context.jobAnalysisSlot.hash,
                resumeStrategyHash: context.resumeStrategySlot.hash,
              },
            ),
          ],
        },
      });
    }

    const approved = interruptForTailoredResumeDirectionConfirmation({
      jobAnalysisSummary: context.jobAnalysisSummary,
      resumeStrategyMarkdown: context.resumeStrategySlot.markdown,
      missingFacts: context.strategy.missingFacts,
      assumptions: context.strategy.assumptions,
      sourceTool: "confirm_tailored_resume_direction",
    });

    if (!approved) {
      throw new Error("用户拒绝了当前定制方向，已停止继续生成 tailoredResume。");
    }

    const approvedAt = new Date().toISOString();

    return new Command({
      update: {
        tailoredResumeDirectionConfirmation: {
          approvedAt,
          jobAnalysisHash: context.jobAnalysisSlot.hash,
          resumeStrategyHash: context.resumeStrategySlot.hash,
          sourceTool: "confirm_tailored_resume_direction",
        },
        messages: [
          makeToolMessage(
            "confirm_tailored_resume_direction",
            runtime.toolCallId,
            {
              ok: true,
              confirmationStatus: "confirmed",
              approvedAt,
              jobAnalysisHash: context.jobAnalysisSlot.hash,
              resumeStrategyHash: context.resumeStrategySlot.hash,
            },
          ),
        ],
      },
    });
  },
  {
    name: "confirm_tailored_resume_direction",
    description:
      "固定 HITL 步骤：读取当前已沉淀的岗位分析与简历策略，向用户展示“确认定制方向”卡片；确认后写入当前方向的确认状态。",
    schema: z.object({}),
  },
);

// 默认工作流：在岗位分析和简历策略可用的前提下生成模板友好的定制简历。
export const prepareTailoredResume = tool(
  async (
    {
      resumeInstruction,
      strategyInstruction,
      jobAnalysisInstruction,
      refreshJobAnalysis,
      refreshResumeStrategy,
    },
    runtime: ToolRuntime<MissionState>,
  ): Promise<Command> => {
    const preparedStrategy = await prepareResumeStrategyArtifacts({
      state: runtime.state,
      strategyInstruction,
      jobAnalysisInstruction,
      refreshJobAnalysis,
      refreshResumeStrategy,
    });
    const directionConfirmed = isTailoredResumeDirectionConfirmationCurrent({
      confirmation: runtime.state.tailoredResumeDirectionConfirmation,
      jobAnalysisHash: preparedStrategy.jobAnalysisSlot.hash,
      resumeStrategyHash: preparedStrategy.resumeStrategySlot.hash,
    });

    if (!directionConfirmed) {
      const shouldInvalidateDownstream =
        preparedStrategy.jobAnalysisStatus === "generated" ||
        preparedStrategy.resumeStrategyStatus === "generated";
      const artifacts = shouldInvalidateDownstream
        ? {
            ...preparedStrategy.artifacts,
            tailoredResume: undefined,
            interviewPack: undefined,
          }
        : preparedStrategy.artifacts;

      return new Command({
        update: {
          artifacts,
          reviews: preparedStrategy.reviews,
          tailoredResume: shouldInvalidateDownstream
            ? undefined
            : runtime.state.tailoredResume,
          interviewPack: shouldInvalidateDownstream
            ? undefined
            : runtime.state.interviewPack,
          tailoredResumeDirectionConfirmation: {},
          messages: [
            makeToolMessage("prepare_tailored_resume", runtime.toolCallId, {
              ok: true,
              requiresDirectionConfirmation: true,
              nextSuggestedTool: "confirm_tailored_resume_direction",
              jobAnalysisStatus: preparedStrategy.jobAnalysisStatus,
              resumeStrategyStatus: preparedStrategy.resumeStrategyStatus,
              jobAnalysisUpdatedAt: preparedStrategy.jobAnalysisSlot.updatedAt,
              jobAnalysisHash: preparedStrategy.jobAnalysisSlot.hash,
              jobAnalysisSummary: preparedStrategy.jobAnalysisSummary,
              resumeStrategyUpdatedAt:
                preparedStrategy.resumeStrategySlot.updatedAt,
              resumeStrategyHash: preparedStrategy.resumeStrategySlot.hash,
              missingFacts: preparedStrategy.strategy.missingFacts,
              assumptions: preparedStrategy.strategy.assumptions,
            }),
          ],
        },
      });
    }

    const prepared = await prepareTailoredResumeArtifacts({
      state: {
        ...runtime.state,
        artifacts: preparedStrategy.artifacts,
        reviews: preparedStrategy.reviews,
      },
      preparedStrategy,
      resumeInstruction,
      refreshTailoredResume: true,
    });

    return new Command({
      update: {
        tailoredResume: prepared.tailored.resume,
        artifacts: prepared.artifacts,
        reviews: prepared.reviews,
        tailoredResumeDirectionConfirmation:
          runtime.state.tailoredResumeDirectionConfirmation,
        messages: [
          makeToolMessage("prepare_tailored_resume", runtime.toolCallId, {
            ok: true,
            jobAnalysisStatus: prepared.jobAnalysisStatus,
            resumeStrategyStatus: prepared.resumeStrategyStatus,
            tailoredDirectionConfirmationStatus: "confirmed",
            jobAnalysisUpdatedAt: prepared.jobAnalysisSlot.updatedAt,
            jobAnalysisHash: prepared.jobAnalysisSlot.hash,
            jobAnalysisSummary: prepared.jobAnalysisSummary,
            resumeStrategyUpdatedAt: prepared.resumeStrategySlot.updatedAt,
            resumeStrategyHash: prepared.resumeStrategySlot.hash,
            tailoredResumeUpdatedAt: prepared.tailoredResumeSlot.updatedAt,
            tailoredResumeHash: prepared.tailoredResumeSlot.hash,
            locale: prepared.tailored.resume.locale,
            targetRole: prepared.tailored.resume.targetRole,
            sectionOrder: prepared.tailored.resume.templateHints.sectionOrder,
            pageTarget: prepared.tailored.resume.templateHints.pageTarget,
            changeSummary: prepared.tailored.changeSummary,
            warnings: prepared.tailored.resume.warnings,
            missingFacts: prepared.tailored.resume.missingFacts,
          }),
        ],
      },
    });
  },
  {
    name: "prepare_tailored_resume",
    description:
      "默认工作流：生成模板友好的定制简历。它会先确保岗位分析与简历策略可用；若当前方向尚未确认，会先沉淀上游产物并提示主 Agent 调用 confirm_tailored_resume_direction；确认完成后再保存 state.tailoredResume 和 tailoredResume artifact。",
    schema: z.object({
      resumeInstruction: z
        .string()
        .optional()
        .describe("给定制简历生成阶段的补充要求。"),
      strategyInstruction: z
        .string()
        .optional()
        .describe("在需要重建简历策略时，给策略阶段的补充要求。"),
      jobAnalysisInstruction: z
        .string()
        .optional()
        .describe("在需要重建岗位分析时，给岗位分析阶段的补充要求。"),
      refreshJobAnalysis: z
        .boolean()
        .default(false)
        .describe("是否强制重做岗位分析。"),
      refreshResumeStrategy: z
        .boolean()
        .default(false)
        .describe("是否强制重做简历策略。"),
    }),
  },
);

// 默认工作流：在岗位分析、简历策略和定制简历可用的前提下生成结构化面试包。
export const prepareInterviewPack = tool(
  async (
    {
      interviewInstruction,
      resumeInstruction,
      strategyInstruction,
      jobAnalysisInstruction,
      refreshJobAnalysis,
      refreshResumeStrategy,
      refreshTailoredResume,
      refreshInterviewPack,
    },
    runtime: ToolRuntime<MissionState>,
  ): Promise<Command> => {
    const jdText = requireJdText(runtime.state);
    const preparedStrategy = await prepareResumeStrategyArtifacts({
      state: runtime.state,
      strategyInstruction,
      jobAnalysisInstruction,
      refreshJobAnalysis,
      refreshResumeStrategy,
    });
    const shouldRegenerateTailored =
      refreshTailoredResume ||
      preparedStrategy.jobAnalysisStatus === "generated" ||
      preparedStrategy.resumeStrategyStatus === "generated" ||
      !preparedStrategy.artifacts.tailoredResume ||
      !runtime.state.tailoredResume;
    const directionConfirmed = isTailoredResumeDirectionConfirmationCurrent({
      confirmation: runtime.state.tailoredResumeDirectionConfirmation,
      jobAnalysisHash: preparedStrategy.jobAnalysisSlot.hash,
      resumeStrategyHash: preparedStrategy.resumeStrategySlot.hash,
    });

    if (shouldRegenerateTailored && !directionConfirmed) {
      const shouldInvalidateDownstream =
        preparedStrategy.jobAnalysisStatus === "generated" ||
        preparedStrategy.resumeStrategyStatus === "generated";
      const artifacts = shouldInvalidateDownstream
        ? {
            ...preparedStrategy.artifacts,
            tailoredResume: undefined,
            interviewPack: undefined,
          }
        : preparedStrategy.artifacts;

      return new Command({
        update: {
          artifacts,
          reviews: preparedStrategy.reviews,
          tailoredResume: shouldInvalidateDownstream
            ? undefined
            : runtime.state.tailoredResume,
          interviewPack: shouldInvalidateDownstream
            ? undefined
            : runtime.state.interviewPack,
          tailoredResumeDirectionConfirmation: {},
          messages: [
            makeToolMessage("prepare_interview_pack", runtime.toolCallId, {
              ok: true,
              requiresDirectionConfirmation: true,
              nextSuggestedTool: "confirm_tailored_resume_direction",
              jobAnalysisStatus: preparedStrategy.jobAnalysisStatus,
              resumeStrategyStatus: preparedStrategy.resumeStrategyStatus,
              jobAnalysisUpdatedAt: preparedStrategy.jobAnalysisSlot.updatedAt,
              jobAnalysisHash: preparedStrategy.jobAnalysisSlot.hash,
              jobAnalysisSummary: preparedStrategy.jobAnalysisSummary,
              resumeStrategyUpdatedAt:
                preparedStrategy.resumeStrategySlot.updatedAt,
              resumeStrategyHash: preparedStrategy.resumeStrategySlot.hash,
              missingFacts: preparedStrategy.strategy.missingFacts,
              assumptions: preparedStrategy.strategy.assumptions,
            }),
          ],
        },
      });
    }

    const prepared = await prepareTailoredResumeArtifacts({
      state: {
        ...runtime.state,
        artifacts: preparedStrategy.artifacts,
        reviews: preparedStrategy.reviews,
      },
      preparedStrategy,
      resumeInstruction,
      refreshTailoredResume,
    });

    const shouldRegenerateInterviewPack =
      refreshInterviewPack ||
      prepared.tailoredResumeStatus === "generated" ||
      !prepared.artifacts.interviewPack ||
      !runtime.state.interviewPack;

    let interviewPackStatus: "generated" | "reused" = "reused";
    let interviewPack: InterviewPackOutput;
    const artifacts = {
      ...prepared.artifacts,
    };

    if (shouldRegenerateInterviewPack) {
      interviewPack = await invokeInterviewPackAgent({
        jdText,
        jobAnalysis: prepared.jobAnalysisSlot.markdown,
        resumeStrategy: prepared.resumeStrategySlot.markdown,
        tailoredResumeMarkdown: prepared.tailoredResumeSlot.markdown,
        tailoredResumeJson: JSON.stringify(prepared.tailored.resume, null, 2),
        userInstruction: interviewInstruction,
      });

      const nextInterviewPack = createArtifactSlot({
        markdown: interviewPack.markdown,
        sourceAgent: "interview_pack_agent",
        notes: [
          ...interviewPack.pack.sellingPoints.map((item) => `卖点：${item.point}`),
          ...interviewPack.pack.warnings.map((item) => `注意：${item}`),
          ...interviewPack.pack.missingFacts.map((item) => `待确认：${item}`),
        ],
      });

      artifacts.interviewPack = nextInterviewPack.slot;
      interviewPackStatus = "generated";
    } else {
      const reusedInterviewPack = runtime.state.interviewPack;
      const reusedInterviewPackSlot = artifacts.interviewPack;
      if (!reusedInterviewPack || !reusedInterviewPackSlot) {
        throw new Error("面试包复用失败：缺少结构化 state 或正式 artifact。");
      }

      interviewPack = {
        pack: reusedInterviewPack,
        markdown: reusedInterviewPackSlot.markdown,
      };
    }

    return new Command({
      update: {
        tailoredResume: prepared.tailored.resume,
        interviewPack: interviewPack.pack,
        artifacts,
        reviews: prepared.reviews,
        tailoredResumeDirectionConfirmation:
          runtime.state.tailoredResumeDirectionConfirmation,
        messages: [
          makeToolMessage("prepare_interview_pack", runtime.toolCallId, {
            ok: true,
            jobAnalysisStatus: prepared.jobAnalysisStatus,
            resumeStrategyStatus: prepared.resumeStrategyStatus,
            tailoredResumeStatus: prepared.tailoredResumeStatus,
            tailoredDirectionConfirmationStatus: shouldRegenerateTailored
              ? "confirmed"
              : "not_needed",
            interviewPackStatus,
            interviewPackUpdatedAt: artifacts.interviewPack?.updatedAt,
            interviewPackHash: artifacts.interviewPack?.hash,
            locale: interviewPack.pack.locale,
            targetRole: interviewPack.pack.targetRole,
            sellingPointCount: interviewPack.pack.sellingPoints.length,
            likelyQuestionCount: interviewPack.pack.likelyQuestions.length,
            questionsToAskCount: interviewPack.pack.questionsToAsk.length,
            warnings: interviewPack.pack.warnings,
            missingFacts: interviewPack.pack.missingFacts,
          }),
        ],
      },
    });
  },
  {
    name: "prepare_interview_pack",
    description:
      "默认工作流：生成结构化面试包。它会先确保岗位分析、简历策略和定制简历可用；若需要新生成定制简历但当前方向尚未确认，会先沉淀上游产物并提示主 Agent 调用 confirm_tailored_resume_direction；确认完成后再继续保存 state.interviewPack 和 interviewPack artifact。",
    schema: z.object({
      interviewInstruction: z
        .string()
        .optional()
        .describe("给面试包生成阶段的补充要求。"),
      resumeInstruction: z
        .string()
        .optional()
        .describe("在需要重建定制简历时，给定制简历阶段的补充要求。"),
      strategyInstruction: z
        .string()
        .optional()
        .describe("在需要重建简历策略时，给策略阶段的补充要求。"),
      jobAnalysisInstruction: z
        .string()
        .optional()
        .describe("在需要重建岗位分析时，给岗位分析阶段的补充要求。"),
      refreshJobAnalysis: z
        .boolean()
        .default(false)
        .describe("是否强制重做岗位分析。"),
      refreshResumeStrategy: z
        .boolean()
        .default(false)
        .describe("是否强制重做简历策略。"),
      refreshTailoredResume: z
        .boolean()
        .default(false)
        .describe("是否强制重做定制简历。"),
      refreshInterviewPack: z
        .boolean()
        .default(false)
        .describe("是否强制重做面试包。"),
    }),
  },
);

// 手动写入正式 artifact，适合保存已确认的 Markdown 产物。
// TODO 也许不应该暴露这么底层的工具了，后续可以考虑把它封装在更高层的 prepare_* 工具里，让它们内部负责把正式产物沉淀到 state 和 artifacts。
export const updateArtifact = tool(
  async (
    { artifactType, markdown, sourceAgent, notes },
    runtime: ToolRuntime<MissionState>,
  ): Promise<Command> => {
    const { slot, updatedAt, hash } = createArtifactSlot({
      markdown,
      sourceAgent,
      notes,
    });

    return new Command({
      update: {
        artifacts: {
          ...runtime.state.artifacts,
          [artifactType]: slot,
        },
        messages: [
          makeToolMessage("update_artifact", runtime.toolCallId, {
            ok: true,
            artifactType,
            updatedAt,
            hash,
          }),
        ],
      },
    });
  },
  {
    name: "update_artifact",
    description:
      "保存已经确认好的正式 markdown 产物，供后续审查、导出和流程复用。",
    schema: z.object({
      artifactType: ArtifactTypeSchema,
      markdown: z.string().min(1),
      sourceAgent: z.string().optional(),
      notes: z.array(z.string()).optional(),
    }),
  },
);

// 手动写入正式 review 结论，供后续导出 gating 和流程复用。
export const updateReview = tool(
  async (
    { targetArtifactType, verdict },
    runtime: ToolRuntime<MissionState>,
  ): Promise<Command> => {
    const parsedVerdict = CriticVerdictSchema.parse(verdict);

    return new Command({
      update: {
        reviews: {
          ...runtime.state.reviews,
          [targetArtifactType]: parsedVerdict,
        },
        messages: [
          makeToolMessage("update_review", runtime.toolCallId, {
            ok: true,
            targetArtifactType,
            outcome: parsedVerdict.outcome,
          }),
        ],
      },
    });
  },
  {
    name: "update_review",
    description: "保存指定正式产物的审查结论，供后续导出判断和流程复用。",
    schema: z.object({
      targetArtifactType: ReviewTargetArtifactTypeSchema,
      verdict: CriticVerdictSchema,
    }),
  },
);

// 将 Mission 标记为等待人工确认，并把问题与原因写入状态。
export const requestHumanConfirmation = tool(
  async (
    { question, reason, targetArtifactType },
    runtime: ToolRuntime<MissionState>,
  ): Promise<Command> => {
    const payload: HumanConfirmationRequest =
      HumanConfirmationRequestSchema.parse({
        active: true,
        question,
        reason,
        targetArtifactType,
      });

    return new Command({
      update: {
        pendingHumanConfirmation: payload,
        messages: [
          makeToolMessage(
            "request_human_confirmation",
            runtime.toolCallId,
            payload,
          ),
        ],
      },
    });
  },
  {
    name: "request_human_confirmation",
    description: "把当前流程标记为等待人工确认。",
    schema: z.object({
      question: z.string().min(1),
      reason: z.string().min(1),
      targetArtifactType: ArtifactTypeSchema.optional(),
    }),
  },
);

// 清除等待人工确认状态，让主流程可以继续自动推进。
export const clearHumanConfirmation = tool(
  async (_input, runtime: ToolRuntime<MissionState>): Promise<Command> => {
    const payload = {
      ok: true,
      active: false as const,
    };

    return new Command({
      update: {
        pendingHumanConfirmation: {
          active: false,
        },
        messages: [
          makeToolMessage(
            "clear_human_confirmation",
            runtime.toolCallId,
            payload,
          ),
        ],
      },
    });
  },
  {
    name: "clear_human_confirmation",
    description: "结束当前人工确认等待状态，使流程可以继续推进。",
    schema: z.object({}),
  },
);

// 手动/高级路径：单独重做岗位分析，并立即沉淀正式 artifact；审查是否需要执行由主 agent 显式决定。
export const runJobScoutAgent = tool(
  async (
    { userInstruction },
    runtime: ToolRuntime<MissionState>,
  ): Promise<Command> => {
    const prepared = await prepareJobAnalysisArtifact({
      state: runtime.state,
      jobAnalysisInstruction: userInstruction,
      refresh: true,
    });

    return new Command({
      update: {
        artifacts: prepared.artifacts,
        reviews: prepared.reviews,
        messages: [
          makeToolMessage("job_scout_agent", runtime.toolCallId, {
            ok: true,
            jobAnalysisStatus: prepared.jobAnalysisStatus,
            jobAnalysisUpdatedAt: prepared.jobAnalysisSlot.updatedAt,
            jobAnalysisHash: prepared.jobAnalysisSlot.hash,
            jobAnalysisSummary: prepared.jobAnalysisSummary,
          }),
        ],
      },
    });
  },
  {
    name: "job_scout_agent",
    description:
      "手动/高级路径：单独生成或重做岗位分析，并沉淀正式结果。若需要人工或 LLM 审查，请额外显式调用 critic_agent。",
    schema: z.object({
      userInstruction: z.string().optional(),
    }),
  },
);

// 手动/高级路径：在已有 jobAnalysis 前提下单独生成简历策略。
export const runResumeStrategistAgent = tool(
  async (
    { userInstruction },
    runtime: ToolRuntime<MissionState>,
  ): Promise<ResumeStrategyOutput & { artifactType: "resumeStrategy" }> => {
    const jdText = requireJdText(runtime.state);
    const jobAnalysisSlot = runtime.state.artifacts.jobAnalysis;
    if (!jobAnalysisSlot) {
      throw new Error(
        "还没有可用的岗位分析。若当前目标是拿到简历策略，请优先调用 prepare_resume_strategy。",
      );
    }

    const jobAnalysis = jobAnalysisSlot.markdown;
    const resumeContext = requireResumeContext(runtime.state);

    const strategy = await invokeResumeStrategistAgent({
      jdText,
      jobAnalysis,
      resumeContext,
      userInstruction,
    });

    return {
      artifactType: "resumeStrategy",
      ...strategy,
    };
  },
  {
    name: "resume_strategist_agent",
    description:
      "手动/高级路径：仅在岗位分析已经可用时单独生成简历策略。默认应优先使用 prepare_resume_strategy。",
    schema: z.object({
      userInstruction: z.string().optional(),
    }),
  },
);

// 手动/高级路径：在已有 jobAnalysis 和 resumeStrategy 前提下单独生成定制简历。
export const runTailoredResumeAgent = tool(
  async (
    { userInstruction },
    runtime: ToolRuntime<MissionState>,
  ): Promise<TailoredResumeOutput & { artifactType: "tailoredResume" }> => {
    const jdText = requireJdText(runtime.state);
    const context = getTailoredResumeDirectionContext(runtime.state);
    const directionConfirmed = isTailoredResumeDirectionConfirmationCurrent({
      confirmation: runtime.state.tailoredResumeDirectionConfirmation,
      jobAnalysisHash: context.jobAnalysisSlot.hash,
      resumeStrategyHash: context.resumeStrategySlot.hash,
    });

    if (!directionConfirmed) {
      const approved = interruptForTailoredResumeDirectionConfirmation({
        jobAnalysisSummary: context.jobAnalysisSummary,
        resumeStrategyMarkdown: context.resumeStrategySlot.markdown,
        missingFacts: context.strategy.missingFacts,
        assumptions: context.strategy.assumptions,
        sourceTool: "tailored_resume_agent",
      });
      if (!approved) {
        throw new Error("用户拒绝了当前定制方向，已停止生成 tailoredResume。");
      }
    }

    const tailored = await invokeTailoredResumeAgent({
      jdText,
      jobAnalysis: context.jobAnalysisSlot.markdown,
      resumeStrategy: context.resumeStrategySlot.markdown,
      resumeContext: requireResumeContext(runtime.state),
      userInstruction,
    });

    return {
      artifactType: "tailoredResume",
      ...tailored,
    };
  },
  {
    name: "tailored_resume_agent",
    description:
      "手动/高级路径：仅在岗位分析和简历策略已经可用时单独生成定制简历。若当前方向尚未确认，会先触发“确认定制方向”卡片；默认应优先使用 prepare_tailored_resume。",
    schema: z.object({
      userInstruction: z.string().optional(),
    }),
  },
);

// 手动/高级路径：在已有 jobAnalysis、resumeStrategy 和 tailoredResume 前提下单独生成面试包。
export const runInterviewPackAgent = tool(
  async (
    { userInstruction },
    runtime: ToolRuntime<MissionState>,
  ): Promise<InterviewPackOutput & { artifactType: "interviewPack" }> => {
    const jdText = requireJdText(runtime.state);
    const jobAnalysisSlot = runtime.state.artifacts.jobAnalysis;
    const resumeStrategySlot = runtime.state.artifacts.resumeStrategy;
    const tailoredResumeSlot = runtime.state.artifacts.tailoredResume;

    if (!jobAnalysisSlot || !resumeStrategySlot || !tailoredResumeSlot) {
      throw new Error(
        "还没有可用的岗位分析、简历策略或定制简历。若当前目标是拿到面试包，请优先调用 prepare_interview_pack。",
      );
    }

    const interviewPack = await invokeInterviewPackAgent({
      jdText,
      jobAnalysis: jobAnalysisSlot.markdown,
      resumeStrategy: resumeStrategySlot.markdown,
      tailoredResumeMarkdown: tailoredResumeSlot.markdown,
      tailoredResumeJson: runtime.state.tailoredResume
        ? JSON.stringify(runtime.state.tailoredResume, null, 2)
        : undefined,
      userInstruction,
    });

    return {
      artifactType: "interviewPack",
      ...interviewPack,
    };
  },
  {
    name: "interview_pack_agent",
    description:
      "手动/高级路径：仅在岗位分析、简历策略和定制简历已经可用时单独生成面试包。默认应优先使用 prepare_interview_pack。",
    schema: z.object({
      userInstruction: z.string().optional(),
    }),
  },
);

// 手动/高级路径：审查已经沉淀的正式产物，并返回结构化 review 结果。
export const runCriticAgent = tool(
  async (
    { targetArtifactType, reviewInstruction },
    runtime: ToolRuntime<MissionState>,
  ): Promise<
    CriticVerdict & { targetArtifactType: ReviewTargetArtifactType }
  > => {
    const context = buildCriticContext(runtime.state, targetArtifactType);
    const messageBlocks = [
      context,
      reviewInstruction?.trim()
        ? `补充审查要求：${reviewInstruction.trim()}`
        : undefined,
    ].filter((block): block is string => Boolean(block));

    const rawResult = await criticAgent.invoke({
      messages: [{ role: "user", content: messageBlocks.join("\n\n") }],
    });

    const verdict = requireStructuredResponse({
      value: rawResult.structuredResponse,
      schema: CriticVerdictSchema,
      agentName: "critic_agent",
    });

    return {
      targetArtifactType,
      ...verdict,
    };
  },
  {
    name: "critic_agent",
    description: "审查已经存在的正式产物，并返回结构化审查结论。",
    schema: z.object({
      targetArtifactType: ReviewTargetArtifactTypeSchema,
      reviewInstruction: z.string().optional(),
    }),
  },
);

export const TOOLS = [
  extractJdText,
  ingestResumeFromUrl,
  prepareResumeStrategy,
  confirmTailoredResumeDirection,
  prepareTailoredResume,
  prepareInterviewPack,
  updateReview,
  requestHumanConfirmation,
  clearHumanConfirmation,
  runJobScoutAgent,
  runResumeStrategistAgent,
  runTailoredResumeAgent,
  runInterviewPackAgent,
  runCriticAgent,
];
