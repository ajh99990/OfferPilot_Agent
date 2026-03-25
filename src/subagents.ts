import { createAgent } from "langchain";
import { createDefaultModel, createFileIngestModel } from "./model.js";
import {
  CRITIC_SYSTEM_PROMPT,
  INTERVIEW_PACK_SYSTEM_PROMPT,
  JOB_SCOUT_SYSTEM_PROMPT,
  RESUME_INGEST_SYSTEM_PROMPT,
  RESUME_STRATEGIST_SYSTEM_PROMPT,
  TAILORED_RESUME_SYSTEM_PROMPT,
} from "./prompts.js";
import {
  CriticVerdictSchema,
  InterviewPackOutputSchema,
  JobScoutReportSchema,
  ResumeIngestOutputSchema,
  ResumeStrategyOutputSchema,
  TailoredResumeOutputSchema,
} from "./types.js";

export const resumeIngestAgent = createAgent({
  name: "resumeIngestAgent",
  description: "负责读取 PDF 简历并输出结构化 Markdown 解析结果。",
  model: createFileIngestModel(),
  tools: [],
  systemPrompt: RESUME_INGEST_SYSTEM_PROMPT,
  responseFormat: ResumeIngestOutputSchema,
});

export const jobScoutAgent = createAgent({
  name: "jobScoutAgent",
  description: "负责理解 JD，并按固定结构输出岗位分析结果。",
  model: createDefaultModel(),
  tools: [],
  systemPrompt: JOB_SCOUT_SYSTEM_PROMPT,
  responseFormat: JobScoutReportSchema,
});

export const resumeStrategistAgent = createAgent({
  name: "resumeStrategistAgent",
  description: "负责基于 JD 与候选人背景输出结构化简历策略。",
  model: createDefaultModel(),
  tools: [],
  systemPrompt: RESUME_STRATEGIST_SYSTEM_PROMPT,
  responseFormat: ResumeStrategyOutputSchema,
});

export const tailoredResumeAgent = createAgent({
  name: "tailoredResumeAgent",
  description: "负责基于 JD、岗位分析、简历策略与基础简历生成结构化定制简历。",
  model: createDefaultModel(),
  tools: [],
  systemPrompt: TAILORED_RESUME_SYSTEM_PROMPT,
  responseFormat: TailoredResumeOutputSchema,
});

export const interviewPackAgent = createAgent({
  name: "interviewPackAgent",
  description: "负责基于岗位分析、简历策略与定制简历生成结构化面试包。",
  model: createDefaultModel(),
  tools: [],
  systemPrompt: INTERVIEW_PACK_SYSTEM_PROMPT,
  responseFormat: InterviewPackOutputSchema,
});

export const criticAgent = createAgent({
  name: "criticAgent",
  description: "负责审查正式产物并输出结构化审查结论。",
  model: createDefaultModel(),
  tools: [],
  systemPrompt: CRITIC_SYSTEM_PROMPT,
  responseFormat: CriticVerdictSchema,
});
