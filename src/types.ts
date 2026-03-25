import { z } from "zod";

export const ARTIFACT_TYPE_VALUES = [
  "jobAnalysis",
  "resumeStrategy",
  "tailoredResume",
  "interviewPack",
] as const;

export const ArtifactTypeSchema = z.enum(ARTIFACT_TYPE_VALUES);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const REVIEW_TARGET_ARTIFACT_TYPE_VALUES = [
  "jobAnalysis",
  "resumeStrategy",
  "tailoredResume",
  "interviewPack",
] as const;

export const ReviewTargetArtifactTypeSchema = z.enum(
  REVIEW_TARGET_ARTIFACT_TYPE_VALUES
);
export type ReviewTargetArtifactType = z.infer<
  typeof ReviewTargetArtifactTypeSchema
>;

export const JdSourceTypeSchema = z.enum(["text", "url"]);
export type JdSourceType = z.infer<typeof JdSourceTypeSchema>;

export const ArtifactSlotSchema = z.object({
  markdown: z.string().min(1),
  updatedAt: z.string().min(1),
  hash: z.string().min(1),
  sourceAgent: z.string().optional(),
  notes: z.array(z.string()).default([]),
});
export type ArtifactSlot = z.infer<typeof ArtifactSlotSchema>;

export const ArtifactRegistrySchema = z
  .object({
    jobAnalysis: ArtifactSlotSchema.optional(),
    resumeStrategy: ArtifactSlotSchema.optional(),
    tailoredResume: ArtifactSlotSchema.optional(),
    interviewPack: ArtifactSlotSchema.optional(),
  })
  .default({});
export type ArtifactRegistry = z.infer<typeof ArtifactRegistrySchema>;

export const CriticVerdictSchema = z
  .object({
    outcome: z
      .enum(["pass", "needs_user_confirmation"])
      .describe(
        "整体审查结论：pass=当前版本可继续流程；needs_user_confirmation=存在高影响歧义或判断，需要用户明确确认后才能继续。",
      ),
    summary: z
      .string()
      .min(1)
      .describe("对本次审查结果的一句高密度总结，适合给主 Agent 或用户快速阅读。"),
    concerns: z
      .array(z.string())
      .default([])
      .describe("导致通过受阻的关键顾虑、风险点或待确认判断，使用简短要点列表，通常控制在 1 到 3 条。"),
    question: z
      .string()
      .optional()
      .describe("当 outcome=needs_user_confirmation 时，给用户的确认问题；pass 时通常留空。"),
    userConfirmed: z
      .boolean()
      .optional()
      .describe("仅由工作流在用户明确确认后补写为 true；critic_agent 本身不负责填写。"),
  })
  .describe("审查 Agent 的结构化输出，用于表达正式产物是否可继续流程，或是否必须先经过用户确认。");
export type CriticVerdict = z.infer<typeof CriticVerdictSchema>;

export const ReviewRegistrySchema = z
  .object({
    jobAnalysis: CriticVerdictSchema.optional(),
    resumeStrategy: CriticVerdictSchema.optional(),
    tailoredResume: CriticVerdictSchema.optional(),
    interviewPack: CriticVerdictSchema.optional(),
  })
  .default({});
export type ReviewRegistry = z.infer<typeof ReviewRegistrySchema>;

export const PendingHumanConfirmationSchema = z
  .object({
    active: z.boolean().default(false),
    reason: z.string().optional(),
    targetArtifactType: ArtifactTypeSchema.optional(),
    question: z.string().optional(),
  })
  .default({ active: false });
export type PendingHumanConfirmation = z.infer<
  typeof PendingHumanConfirmationSchema
>;

export const TailoredResumeDirectionConfirmationSchema = z
  .object({
    approvedAt: z
      .string()
      .optional()
      .describe("最近一次确认定制方向的时间。"),
    jobAnalysisHash: z
      .string()
      .optional()
      .describe("确认时所基于的 jobAnalysis artifact hash。"),
    resumeStrategyHash: z
      .string()
      .optional()
      .describe("确认时所基于的 resumeStrategy artifact hash。"),
    sourceTool: z
      .string()
      .optional()
      .describe("记录这次确认来自哪个 tool，便于调试和埋点。"),
  })
  .default({})
  .describe("定制方向确认状态。只有当其中保存的 artifact hash 与当前上游产物 hash 一致时，才代表当前定制方向仍然有效。");
export type TailoredResumeDirectionConfirmation = z.infer<
  typeof TailoredResumeDirectionConfirmationSchema
>;

export const BinaryConfirmationDecisionIdSchema = z
  .enum(["approve", "reject"])
  .describe("二元确认操作的稳定标识。approve=确认继续；reject=拒绝继续。");
export type BinaryConfirmationDecisionId = z.infer<
  typeof BinaryConfirmationDecisionIdSchema
>;

export const BinaryConfirmationResumeSourceSchema = z
  .enum([
    "approval_card",
    "questionnaire_card",
    "binary_confirmation_card",
    "simple_binary_confirmation_card",
    "json_editor",
  ])
  .describe("本次恢复值来自哪种前端交互方式。");
export type BinaryConfirmationResumeSource = z.infer<
  typeof BinaryConfirmationResumeSourceSchema
>;

export const BinaryConfirmationOptionSchema = z
  .object({
    id: BinaryConfirmationDecisionIdSchema,
    label: z.string().min(1).describe("前端按钮展示文案。"),
  })
  .describe("二元确认卡片中的单个按钮配置。");
export type BinaryConfirmationOption = z.infer<
  typeof BinaryConfirmationOptionSchema
>;

export const BinaryConfirmationResumeSchema = z
  .object({
    approved: z
      .boolean()
      .describe("用户是否确认继续当前流程。true=继续；false=拒绝继续。"),
    decisionId: BinaryConfirmationDecisionIdSchema.optional().describe(
      "前端按钮的稳定标识，便于埋点和调试。",
    ),
    source: BinaryConfirmationResumeSourceSchema.optional(),
  })
  .describe("通用二元确认卡片恢复运行时推荐发送的结构化 resume payload，适用于 approval_card 等二元确认型 HITL。");
export type BinaryConfirmationResume = z.infer<
  typeof BinaryConfirmationResumeSchema
>;

export const ApprovalCardSectionSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .describe("approval_card 中的一个内容分区标题，例如 当前定制方向、仍待确认的信息。"),
    items: z
      .array(z.string())
      .default([])
      .describe("该分区下的短要点列表。每条都应足够短，适合直接展示成卡片 bullet。"),
  })
  .describe("approval_card 中的单个内容分区。");
export type ApprovalCardSection = z.infer<typeof ApprovalCardSectionSchema>;

export const ApprovalCardInterruptSchema = z
  .object({
    version: z
      .literal(1)
      .describe("interrupt 协议版本号，便于前后端未来做兼容升级。"),
    kind: z
      .string()
      .min(1)
      .describe("业务中断类型，前端据此识别 approval_card 属于哪个业务场景。"),
    ui: z
      .literal("approval_card")
      .describe("推荐前端渲染器类型：使用带摘要、分区和二元按钮的确认卡片。"),
    title: z.string().min(1).describe("卡片标题，前端应直接展示。"),
    summary: z
      .string()
      .min(1)
      .describe("卡片顶部的一段高密度摘要，用于说明当前为什么需要用户确认。"),
    sections: z
      .array(ApprovalCardSectionSchema)
      .default([])
      .describe("卡片主体的分区内容，前端应按顺序渲染。"),
    question: z
      .string()
      .optional()
      .describe("需要直接抛给用户的确认问题。简单确认卡片可留空。"),
    options: z
      .tuple([
        z.object({
          id: z.literal("approve"),
          label: z.string().min(1),
        }),
        z.object({
          id: z.literal("reject"),
          label: z.string().min(1),
        }),
      ])
      .describe("卡片的固定按钮配置：第一个是确认，第二个是拒绝。"),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("可选业务元数据，前端通常不直接展示，只用于埋点、调试或扩展逻辑。"),
  })
  .describe("通用 approval_card interrupt payload。适合确认定制方向、简单继续/停止确认等二元审批型 HITL。");
export type ApprovalCardInterrupt = z.infer<
  typeof ApprovalCardInterruptSchema
>;

export const QuestionnaireCardFieldSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe("问题字段的稳定标识，前端恢复 questionnaire_card 时应使用它作为答案 key。"),
    label: z
      .string()
      .min(1)
      .describe("展示给用户的问题标题。"),
    helpText: z
      .string()
      .optional()
      .describe("问题的补充说明。"),
    placeholder: z
      .string()
      .optional()
      .describe("输入框 placeholder。"),
    required: z
      .boolean()
      .default(true)
      .describe("该问题是否必填。"),
    multiline: z
      .boolean()
      .default(false)
      .describe("前端是否应渲染为多行输入。"),
  })
  .describe("questionnaire_card 中的单个问题定义。");
export type QuestionnaireCardField = z.infer<
  typeof QuestionnaireCardFieldSchema
>;

export const QuestionnaireCardInterruptSchema = z
  .object({
    version: z
      .literal(1)
      .describe("interrupt 协议版本号，便于前后端未来做兼容升级。"),
    kind: z
      .string()
      .min(1)
      .describe("业务中断类型，前端据此识别 questionnaire_card 属于哪个业务场景。"),
    ui: z
      .literal("questionnaire_card")
      .describe("推荐前端渲染器类型：使用带多个问题输入区的问卷卡片。"),
    title: z.string().min(1).describe("卡片标题，前端应直接展示。"),
    summary: z
      .string()
      .optional()
      .describe("卡片顶部说明文字，可用于解释为什么需要补充这些信息。"),
    fields: z
      .array(QuestionnaireCardFieldSchema)
      .min(1)
      .describe("需要前端逐项渲染的问题定义列表。"),
    submitLabel: z
      .string()
      .optional()
      .describe("前端提交按钮文案；未提供时前端可使用默认值。"),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("可选业务元数据，前端通常不直接展示，只用于埋点、调试或扩展逻辑。"),
  })
  .describe("通用 questionnaire_card interrupt payload。适合在未来向用户补充 1 到多条关键信息。");
export type QuestionnaireCardInterrupt = z.infer<
  typeof QuestionnaireCardInterruptSchema
>;

export const QuestionnaireCardResumeSchema = z
  .object({
    answers: z
      .record(z.string(), z.string())
      .describe("questionnaire_card 的答案映射，key 必须对应 field.id。"),
    source: BinaryConfirmationResumeSourceSchema.optional(),
  })
  .describe("questionnaire_card 恢复运行时推荐发送的结构化 resume payload。");
export type QuestionnaireCardResume = z.infer<
  typeof QuestionnaireCardResumeSchema
>;

export const ExtractJdResultSchema = z.object({
  sourceType: JdSourceTypeSchema,
  jdText: z.string().min(1),
  note: z.string().optional(),
});
export type ExtractJdResult = z.infer<typeof ExtractJdResultSchema>;

export const JobScoutReportSchema = z
  .object({
    markdown: z
      .string()
      .min(1)
      .describe("精简版岗位判断卡的 Markdown 正文。应以短区块和短列表为主，避免写成长篇分析报告或大段复述 JD 原文。"),
    title: z
      .string()
      .min(1)
      .describe("对该岗位的简洁标题或分析标题。"),
    summary: z
      .string()
      .min(1)
      .describe("对岗位核心要求和判断的一句高密度总结。"),
    mustHave: z
      .array(z.string())
      .default([])
      .describe("岗位明确要求或强信号必备项，使用简短要点列表，通常控制在 3 到 5 条。"),
    niceToHave: z
      .array(z.string())
      .default([])
      .describe("岗位加分项或弱信号偏好，使用简短要点列表，通常控制在 2 到 3 条。"),
    risks: z
      .array(z.string())
      .default([])
      .describe("候选人投递该岗位时可能遇到的风险、短板或不确定因素，通常控制在 2 到 3 条。"),
    hiddenSignals: z
      .array(z.string())
      .default([])
      .describe("从 JD 字里行间推断出的隐含偏好、团队环境或交付期待；没有足够依据时留空，通常控制在 0 到 2 条。"),
    questionsForUser: z
      .array(z.string())
      .default([])
      .describe("为了提高后续简历定制质量，需要向用户追问的关键问题，通常控制在 0 到 3 条。"),
  })
  .describe("岗位分析 Agent 的结构化输出，用于沉淀 jobAnalysis artifact。整体应更像岗位判断卡，而不是长篇分析报告。");
export type JobScoutReport = z.infer<typeof JobScoutReportSchema>;

export const ResumeStrategyOutputSchema = z
  .object({
    markdown: z
      .string()
      .min(1)
      .describe("精简版简历改写清单的 Markdown 正文。应以短列表说明强调点、删减点和内容组织建议，避免长篇策略文章。"),
    missingFacts: z
      .array(z.string())
      .default([])
      .describe("为了安全、准确地产出定制简历，当前仍缺失的事实信息，通常控制在 0 到 3 条。"),
    assumptions: z
      .array(z.string())
      .default([])
      .describe("在信息不足时临时采用的合理假设，必须明确且可被后续确认或推翻，通常控制在 0 到 2 条。"),
  })
  .describe("简历策略 Agent 的结构化输出，用于沉淀 resumeStrategy artifact。整体应更像简历改写清单，而不是策略报告。");
export type ResumeStrategyOutput = z.infer<typeof ResumeStrategyOutputSchema>;

export const TailoredResumeLocaleSchema = z
  .enum(["zh-CN", "en-US"])
  .describe(
    "定制简历正文的输出语言。应与原始简历语言保持一致；若原始简历明显是英文，则优先使用 en-US。",
  );
export type TailoredResumeLocale = z.infer<typeof TailoredResumeLocaleSchema>;

export const TailoredResumeSectionKeySchema = z.enum([
  "summary",
  "skillGroups",
  "experience",
  "projects",
  "education",
  "certifications",
  "additional",
]).describe("模板章节标识，用于告诉前端各个简历模块的推荐渲染顺序。");
export type TailoredResumeSectionKey = z.infer<
  typeof TailoredResumeSectionKeySchema
>;

export const TailoredResumeLinkSchema = z.object({
  label: z
    .string()
    .min(1)
    .describe("链接的展示名称，例如 GitHub、作品集、项目演示。"),
  url: z
    .string()
    .min(1)
    .describe("可直接跳转的完整链接。必须来自原始简历或明确可确认的信息。"),
}).describe("简历中的可点击链接对象。");
export type TailoredResumeLink = z.infer<typeof TailoredResumeLinkSchema>;

export const TailoredResumeBasicsSchema = z.object({
  fullName: z.string().min(1).describe("候选人的姓名。必须可从原始简历确认。"),
  headline: z
    .string()
    .optional()
    .describe("简短职位标题或个人标签，突出目标岗位匹配度，使用纯文本。"),
  email: z.string().optional().describe("邮箱地址；不确定则留空。"),
  phone: z.string().optional().describe("电话号码；不确定则留空。"),
  location: z
    .string()
    .optional()
    .describe("城市或地区信息，保持原始简历表达，不要脑补详细地址。"),
  website: z
    .string()
    .optional()
    .describe("个人网站链接；若原始简历没有则留空。"),
  linkedin: z
    .string()
    .optional()
    .describe("LinkedIn 链接或标识；若原始简历没有则留空。"),
  github: z
    .string()
    .optional()
    .describe("GitHub 链接或标识；若原始简历没有则留空。"),
  portfolio: z
    .string()
    .optional()
    .describe("作品集链接；若原始简历没有则留空。"),
}).describe("简历顶部的基础身份与联系方式模块。所有字段都应为纯文本。");
export type TailoredResumeBasics = z.infer<typeof TailoredResumeBasicsSchema>;

export const TailoredResumeSummarySchema = z.object({
  title: z
    .string()
    .optional()
    .describe("摘要区的小标题，例如 Profile、个人简介、职业概述。"),
  lines: z
    .array(z.string())
    .default([])
    .describe("摘要正文的要点列表。每条应突出岗位相关价值，避免空泛套话，通常控制在 2 到 3 条。"),
}).describe("简历摘要区，用于在开头快速概括候选人与目标岗位的匹配点。");
export type TailoredResumeSummary = z.infer<typeof TailoredResumeSummarySchema>;

export const TailoredResumeSkillGroupSchema = z.object({
  label: z
    .string()
    .min(1)
    .describe("技能分组名称，例如 Core Skills、前端技术栈、AI Agent 相关能力。"),
  items: z
    .array(z.string())
    .default([])
    .describe("该分组下的技能项列表。优先保留与目标岗位最相关的技能，避免把所有技能都堆进去。"),
}).describe("技能分组模块，供前端按组渲染技能标签或技能列表。");
export type TailoredResumeSkillGroup = z.infer<
  typeof TailoredResumeSkillGroupSchema
>;

export const TailoredResumeExperienceItemSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe("该经历在结构化简历中的稳定标识，用于前端 key 或差异比较。"),
  company: z.string().min(1).describe("公司或组织名称。"),
  title: z.string().min(1).describe("职位名称。"),
  location: z
    .string()
    .optional()
    .describe("工作地点；若原始简历未明确给出则留空。"),
  employmentType: z
    .string()
    .optional()
    .describe("雇佣类型，如全职、实习、兼职；没有明确信息时留空。"),
  dateLabel: z
    .string()
    .min(1)
    .describe("给前端直接展示的时间字符串，例如 2022.03 - 2024.08。"),
  startDate: z
    .string()
    .optional()
    .describe("可选的开始时间原子字段，便于前端排序或高级展示。"),
  endDate: z
    .string()
    .nullable()
    .optional()
    .describe("可选的结束时间原子字段；仍在职可为 null。"),
  isCurrent: z
    .boolean()
    .optional()
    .describe("是否为当前仍在进行中的经历。"),
  summary: z
    .string()
    .optional()
    .describe("对这段经历的简短概括，可选，不要写成长段。"),
  bullets: z
    .array(z.string())
    .min(1)
    .describe("该经历下的成果或职责要点。必须基于原始简历事实，不得虚构，通常控制在 2 到 4 条。"),
  techStack: z
    .array(z.string())
    .optional()
    .describe("与这段经历强相关的技术栈或方法论标签。"),
}).describe("工作经历条目，是定制简历的核心内容模块。");
export type TailoredResumeExperienceItem = z.infer<
  typeof TailoredResumeExperienceItemSchema
>;

export const TailoredResumeProjectItemSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe("该项目在结构化简历中的稳定标识，用于前端 key 或差异比较。"),
  name: z.string().min(1).describe("项目名称。"),
  role: z
    .string()
    .optional()
    .describe("候选人在项目中的角色，例如负责人、核心开发、独立开发者。"),
  dateLabel: z
    .string()
    .optional()
    .describe("给前端直接展示的项目时间字符串。"),
  summary: z
    .string()
    .optional()
    .describe("项目的一句话概括，突出项目目的或业务价值。"),
  bullets: z
    .array(z.string())
    .min(1)
    .describe("项目要点列表。优先保留与目标岗位高度相关的成果与贡献，通常控制在 2 到 3 条。"),
  techStack: z
    .array(z.string())
    .optional()
    .describe("项目涉及的核心技术栈。"),
  links: z
    .array(TailoredResumeLinkSchema)
    .optional()
    .describe("项目相关链接，例如 GitHub、演示站、产品页面。"),
}).describe("项目经历条目，用于承接工作经历之外仍值得展示的项目内容。");
export type TailoredResumeProjectItem = z.infer<
  typeof TailoredResumeProjectItemSchema
>;

export const TailoredResumeEducationItemSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe("教育经历的稳定标识，用于前端渲染和差异比较。"),
  school: z.string().min(1).describe("学校或教育机构名称。"),
  degree: z.string().optional().describe("学位名称，例如本科、硕士。"),
  major: z.string().optional().describe("专业名称。"),
  dateLabel: z
    .string()
    .optional()
    .describe("教育经历展示时间字符串。"),
  location: z.string().optional().describe("学校所在地；不确定则留空。"),
  bullets: z
    .array(z.string())
    .optional()
    .describe("与该教育经历相关的补充亮点，例如荣誉、绩点、重点课程。"),
}).describe("教育经历条目。");
export type TailoredResumeEducationItem = z.infer<
  typeof TailoredResumeEducationItemSchema
>;

export const TailoredResumeCertificationItemSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe("证书条目的稳定标识，用于前端渲染和差异比较。"),
  name: z.string().min(1).describe("证书或资格名称。"),
  issuer: z
    .string()
    .optional()
    .describe("颁发机构名称；不确定则留空。"),
  dateLabel: z
    .string()
    .optional()
    .describe("证书时间展示字符串，例如 2024、2024.06。"),
}).describe("证书或资格认证条目。");
export type TailoredResumeCertificationItem = z.infer<
  typeof TailoredResumeCertificationItemSchema
>;

export const TailoredResumeAdditionalItemSchema = z.object({
  label: z
    .string()
    .min(1)
    .describe("补充信息标签，例如语言能力、签证状态、获奖情况。"),
  value: z
    .string()
    .min(1)
    .describe("对应的补充信息值，使用纯文本，不要写成 HTML。"),
}).describe("补充信息条目，用于承接不适合放入主章节但对岗位有帮助的信息。");
export type TailoredResumeAdditionalItem = z.infer<
  typeof TailoredResumeAdditionalItemSchema
>;

export const TailoredResumeTemplateHintsSchema = z.object({
  variant: z
    .enum(["classic", "professional", "compact"])
    .describe("推荐给前端的模板风格。根据内容气质和岗位类型选择最匹配的一种。"),
  density: z
    .enum(["compact", "balanced"])
    .describe("推荐的信息密度。compact 更紧凑，balanced 更舒展。"),
  sectionOrder: z
    .array(TailoredResumeSectionKeySchema)
    .min(1)
    .describe("章节推荐顺序，前端应优先按这个顺序渲染各模块。"),
  pageTarget: z
    .union([z.literal(1), z.literal(2)])
    .describe("目标页数。默认优先 1 页，信息确实较多时才使用 2 页。"),
}).describe("给前端模板层的版式提示，不是正文内容本身。");
export type TailoredResumeTemplateHints = z.infer<
  typeof TailoredResumeTemplateHintsSchema
>;

export const TailoredResumeSchema = z.object({
  version: z.literal(1).describe("结构化定制简历的数据版本号，当前固定为 1。"),
  locale: TailoredResumeLocaleSchema,
  targetRole: z
    .string()
    .min(1)
    .describe("本次定制简历对齐的目标岗位名称或角色方向。"),
  targetCompany: z
    .string()
    .optional()
    .describe("目标公司名称；JD 中没有或无法确认时可留空。"),
  basics: TailoredResumeBasicsSchema.describe("定制简历顶部基础信息模块。"),
  summary: TailoredResumeSummarySchema.describe(
    "定制简历开头的个人摘要模块，应突出岗位匹配度。",
  ),
  skillGroups: z
    .array(TailoredResumeSkillGroupSchema)
    .default([])
    .describe("技能分组列表。优先展示与目标岗位最相关的技能，通常控制在 2 到 3 组。"),
  experience: z
    .array(TailoredResumeExperienceItemSchema)
    .default([])
    .describe("工作经历列表。通常应作为最重要的主体内容，优先保留最相关的 2 到 4 段经历。"),
  projects: z
    .array(TailoredResumeProjectItemSchema)
    .default([])
    .describe("项目经历列表。用于补充能体现岗位匹配度的重要项目，通常控制在 0 到 2 个。"),
  education: z
    .array(TailoredResumeEducationItemSchema)
    .default([])
    .describe("教育经历列表。"),
  certifications: z
    .array(TailoredResumeCertificationItemSchema)
    .optional()
    .describe("证书或资格认证列表；没有则可省略。"),
  additional: z
    .array(TailoredResumeAdditionalItemSchema)
    .optional()
    .describe("补充信息列表；没有则可省略。"),
  templateHints: TailoredResumeTemplateHintsSchema.describe(
    "供前端模板层使用的版式提示信息。",
  ),
  warnings: z
    .array(z.string())
    .default([])
    .describe("生成过程中需要提醒前端或用户的风险提示，例如信息压缩、事实不确定、原始简历存在缺口。应尽量简短，通常不超过 3 条。"),
  missingFacts: z
    .array(z.string())
    .default([])
    .describe("为了进一步优化这份定制简历，仍需要向用户补充确认的事实信息。应尽量简短，通常不超过 3 条。"),
}).describe(
  "模板友好的结构化定制简历正文。所有字段都应是纯文本或纯文本数组，供前端直接填充模板并渲染 HTML；应优先生成紧凑、可投递的版本，允许改写表达和重排结构，但不得虚构原始简历中不存在的事实。",
);
export type TailoredResume = z.infer<typeof TailoredResumeSchema>;

export const TailoredResumeOutputSchema = z
  .object({
    resume: TailoredResumeSchema.describe(
      "模板友好的结构化定制简历正文，供前端直接填充模板并渲染 HTML。",
    ),
    markdown: z
      .string()
      .min(1)
      .describe("与结构化简历等价的 Markdown 版本，用于审查、导出和流程复用。"),
    changeSummary: z
      .array(z.string())
      .default([])
      .describe("本次定制简历相对基础简历的重要改写点摘要，通常控制在 3 到 5 条。"),
  })
  .describe("定制简历 Agent 的结构化输出，包含模板友好字段与对应 Markdown。");
export type TailoredResumeOutput = z.infer<typeof TailoredResumeOutputSchema>;

export const InterviewPackSelfIntroSchema = z
  .object({
    thirtySecond: z
      .string()
      .min(1)
      .describe("30 秒版自我介绍，适合开场快速建立岗位相关印象，必须足够短。"),
    sixtySecond: z
      .string()
      .min(1)
      .describe("60 秒版自我介绍，适合大多数常规面试开场，是默认主版本。"),
    oneHundredTwentySecond: z
      .string()
      .min(1)
      .describe("120 秒版自我介绍，适合需要更完整经历铺陈的场景，但也不要写成长篇背诵稿。"),
  })
  .describe("面试自我介绍模块，提供三种不同时长的可直接复习文本。");
export type InterviewPackSelfIntro = z.infer<typeof InterviewPackSelfIntroSchema>;

export const InterviewPackSellingPointSchema = z
  .object({
    point: z
      .string()
      .min(1)
      .describe("本次面试最值得强调的一个卖点，应直接对应岗位关注点，使用一句短表达。"),
    evidence: z
      .string()
      .min(1)
      .describe("支撑该卖点的一句事实证据，必须能被原始简历或定制简历内容支撑。"),
  })
  .describe("面试卖点条目，用一句卖点加一句证据帮助用户快速复习。");
export type InterviewPackSellingPoint = z.infer<
  typeof InterviewPackSellingPointSchema
>;

export const InterviewPackLikelyQuestionSchema = z
  .object({
    question: z
      .string()
      .min(1)
      .describe("高概率会被问到的问题，优先覆盖最影响成败的问题。"),
    answerOutline: z
      .array(z.string())
      .min(1)
      .describe("该问题的回答提纲，使用简短要点，不要写成长篇逐字稿，通常控制在 2 到 4 条。"),
  })
  .describe("高概率问题条目，帮助用户围绕重点组织回答。");
export type InterviewPackLikelyQuestion = z.infer<
  typeof InterviewPackLikelyQuestionSchema
>;

export const InterviewPackSchema = z
  .object({
    version: z.literal(1).describe("结构化面试包的数据版本号，当前固定为 1。"),
    locale: TailoredResumeLocaleSchema.describe(
      "面试包正文的输出语言。默认应与定制简历和原始简历保持一致。",
    ),
    targetRole: z
      .string()
      .min(1)
      .describe("本次面试包对齐的目标岗位名称或角色方向。"),
    targetCompany: z
      .string()
      .optional()
      .describe("目标公司名称；JD 中无法确认时可留空。"),
    selfIntro: InterviewPackSelfIntroSchema.describe(
      "三版自我介绍，供用户按不同面试场景选择使用。",
    ),
    sellingPoints: z
      .array(InterviewPackSellingPointSchema)
      .default([])
      .describe("最值得反复强调的卖点列表，通常保持在 3 到 5 条。"),
    likelyQuestions: z
      .array(InterviewPackLikelyQuestionSchema)
      .default([])
      .describe("高概率问题列表，每题只给回答提纲，不给长篇标准答案，通常控制在 5 到 7 题。"),
    questionsToAsk: z
      .array(z.string())
      .default([])
      .describe("建议反问面试官的问题列表，优先保留具体、有信息增量的问题，通常控制在 3 到 4 条。"),
    warnings: z
      .array(z.string())
      .default([])
      .describe("需要提醒用户的风险或保守处理点，例如事实压缩、信息不足、表达需谨慎之处。应尽量简短，通常不超过 3 条。"),
    missingFacts: z
      .array(z.string())
      .default([])
      .describe("为了进一步优化面试包，仍建议向用户补充确认的事实信息。应尽量简短，通常不超过 3 条。"),
  })
  .describe(
    "模板友好的结构化面试包正文。内容应紧凑、可复习、可直接渲染到前端；整体更像复习卡片，而不是面试教材；允许改写表达，但不得虚构原始简历中不存在的事实。",
  );
export type InterviewPack = z.infer<typeof InterviewPackSchema>;

export const InterviewPackOutputSchema = z
  .object({
    pack: InterviewPackSchema.describe(
      "模板友好的结构化面试包正文，供前端直接渲染。",
    ),
    markdown: z
      .string()
      .min(1)
      .describe("与结构化面试包等价的 Markdown 版本，用于审查、导出和流程复用。"),
  })
  .describe("面试包 Agent 的结构化输出，包含前端友好字段与对应 Markdown。");
export type InterviewPackOutput = z.infer<typeof InterviewPackOutputSchema>;

export const ResumeIngestQualitySchema = z.enum(["high", "medium", "low"]);
export type ResumeIngestQuality = z.infer<typeof ResumeIngestQualitySchema>;

export const ResumeIngestOutputSchema = z
  .object({
    markdown: z
      .string()
      .min(1)
      .describe("从 PDF 简历中忠实提取并整理出的 Markdown 正文，用于写入基础简历上下文。"),
    quality: ResumeIngestQualitySchema.describe(
      "本次 PDF 简历解析质量评估。high=结构清晰；medium=可用但有轻微错乱；low=存在明显缺失或顺序问题。",
    ),
    warnings: z
      .array(z.string())
      .default([])
      .describe("解析过程中发现的问题或不确定项，例如分页错乱、双栏顺序异常、疑似遗漏或 OCR 痕迹。"),
  })
  .describe("简历导入 Agent 的结构化输出，用于将 PDF 简历解析为后续流程可消费的 Markdown。");
export type ResumeIngestOutput = z.infer<typeof ResumeIngestOutputSchema>;



export const UpdateArtifactResultSchema = z.object({
  ok: z.literal(true),
  artifactType: ArtifactTypeSchema,
  updatedAt: z.string().min(1),
  hash: z.string().min(1),
});
export type UpdateArtifactResult = z.infer<typeof UpdateArtifactResultSchema>;

export const UpdateReviewResultSchema = z.object({
  ok: z.literal(true),
  targetArtifactType: ReviewTargetArtifactTypeSchema,
  outcome: CriticVerdictSchema.shape.outcome,
});
export type UpdateReviewResult = z.infer<typeof UpdateReviewResultSchema>;

export const HumanConfirmationRequestSchema = z.object({
  active: z.literal(true),
  reason: z.string().min(1),
  targetArtifactType: ArtifactTypeSchema.optional(),
  question: z.string().min(1),
});
export type HumanConfirmationRequest = z.infer<
  typeof HumanConfirmationRequestSchema
>;

export const MissionStateSchema = z.object({
  missionId: z.string().default("mission-demo"),
  missionGoal: z.string().default("围绕目标岗位准备求职材料"),
  jdSourceType: JdSourceTypeSchema.optional(),
  jdSourceValue: z.string().optional(),
  jdText: z.string().default(""),
  baseResumeMarkdown: z.string().optional(),
  tailoredResume: TailoredResumeSchema.optional(),
  interviewPack: InterviewPackSchema.optional(),
  artifacts: ArtifactRegistrySchema,
  reviews: ReviewRegistrySchema,
  pendingHumanConfirmation: PendingHumanConfirmationSchema,
  tailoredResumeDirectionConfirmation:
    TailoredResumeDirectionConfirmationSchema,
});
export type MissionState = z.infer<typeof MissionStateSchema>;
