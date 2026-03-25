# react-agent-js 架构文档

> 版本说明：本文档基于当前仓库代码现状整理，目标是给后续负责 **Next.js 部分** 的 AI / 开发者提供一份**尽可能完整、可落地、且不编造事实**的技术说明。
>
> 仓库路径：`/Users/yangguang/Desktop/简历/react-agent-js`
>
> 重要原则：本文档只描述**当前代码里已经存在的实现**、从代码可以直接推导出的行为，以及代码中可观察到的限制 / 不一致点。不会把尚未实现的能力写成既成事实。

---

## 1. 项目当前定位

这个项目已经不是 README 里那个通用的 LangChain starter，而是一个围绕 **OfferPilot 求职 Mission** 的 Agent 编排项目。

它当前聚焦的核心目标是：

1. 接收并规范化 JD（职位描述）
2. 接收并解析 PDF 简历
3. 生成岗位分析报告（`jobAnalysis`）
4. 基于岗位分析 + 基础简历正文生成简历策略（`resumeStrategy`）
5. 对正式产物进行审查（`critic`）
6. 根据产物类型与 review 状态决定是否允许导出

当前代码的设计重点不是“闲聊型 assistant”，而是一个**有状态的求职 Mission Agent**。

---

## 2. 技术栈与关键依赖

来自 `package.json`：

### 2.1 运行时 / 语言

- Node.js 22（见 `langgraph.json`）
- TypeScript
- ESM（`"type": "module"`）

### 2.2 Agent / LLM 相关依赖

- `langchain@^1.2.3`
- `@langchain/core@^1.1.8`
- `@langchain/langgraph@^1.2.4`
- `@langchain/langgraph-checkpoint@^1.0.1`
- `@langchain/openai@^1.0.0`
- `zod@^4.2.1`

### 2.3 当前实际使用的模型提供方

虽然依赖里有 `@langchain/anthropic`，但**当前代码实际使用的是 OpenAI-compatible provider**。

`.env.example` 只列出了：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`

`src/model.ts` 也只创建了 `ChatOpenAI`。

### 2.4 默认模型

`src/model.ts` 中默认模型名：

- `gpt-5.4`

### 2.5 Responses API 的使用场景

项目当前有两类模型工厂：

1. `createDefaultModel()`
   - 普通文本 / structured output 子 agent 与主 agent 使用
2. `createFileIngestModel()`
   - `useResponsesApi: true`
   - 专门给 PDF 简历解析子 agent 使用

---

## 3. 仓库结构（按当前实际文件）

```txt
react-agent-js/
├── .env
├── .env.example
├── docker-compose.yml
├── eslint.config.ts
├── langgraph.json
├── package.json
├── pnpm-lock.yaml
├── README.md
├── tsconfig.json
└── src/
    ├── agent.ts
    ├── index.ts
    ├── model.ts
    ├── prompts.ts
    ├── subagents.ts
    ├── tools.ts
    └── types.ts
```

### 3.1 每个核心文件的职责

#### `src/agent.ts`
主 agent 定义入口。

- 使用 `createAgent`
- 绑定主 prompt
- 绑定所有 tools
- 绑定 `MissionStateSchema`
- 配置 `MemorySaver` 作为 checkpointer

#### `src/model.ts`
模型工厂。

- `createDefaultModel()`：默认 OpenAI-compatible chat model
- `createFileIngestModel()`：用于 PDF 文件解析，启用 `useResponsesApi: true`

#### `src/types.ts`
系统里所有核心 schema 与 state 定义。

包括：

- 产物类型
- review 类型
- 各类 structured output schema
- 主状态 `MissionStateSchema`

#### `src/prompts.ts`
所有 agent prompt 文本。

包括：

- 主 agent prompt
- `resume_ingest_agent` prompt
- `job_scout_agent` prompt
- `resume_strategist_agent` prompt
- `critic_agent` prompt

#### `src/subagents.ts`
子 agent 定义。

包括：

- `resumeIngestAgent`
- `jobScoutAgent`
- `resumeStrategistAgent`
- `criticAgent`

#### `src/tools.ts`
系统最核心的业务文件。

这里定义了：

- 数据提取工具
- 状态写入工具
- 导出工具
- 子 agent 调用工具
- 默认 workflow 工具 `prepare_resume_strategy`

#### `src/index.ts`
本地 CLI/demo 入口，用于直接调用 agent 做手工测试。

---

## 4. 当前对外暴露的运行入口

### 4.1 LangGraph 图入口

`langgraph.json` 里定义了：

```json
{
  "graphs": {
    "agent": "./src/agent.ts:agent"
  },
  "env": ".env"
}
```

这意味着：

- LangGraph / LangGraph API 看到的 graph 名称是 `agent`
- 实际导出对象来自 `src/agent.ts` 的 `agent`

### 4.2 本地脚本入口

来自 `package.json`：

- `pnpm start` → `tsx src/index.ts`
- `pnpm dev` → `tsx watch src/index.ts`
- `pnpm build` → `tsc`

### 4.3 Docker / LangGraph API 入口

`docker-compose.yml` 定义了：

- `langgraph-redis`
- `langgraph-postgres`
- `langgraph-api`

其中：

- `langgraph-api` 暴露端口：`8123 -> 8000`
- 环境变量包括：`REDIS_URI`、`DATABASE_URI` 等

**但需要注意：**
当前应用代码本身在 `src/agent.ts` 里仍然显式使用的是 `MemorySaver()`，而不是代码里手工接入的 Redis/Postgres checkpointer/store。

也就是说：

- Docker Compose 提供了 LangGraph API 运行环境
- 但当前 TypeScript 代码中，可直接看到的 checkpointer 仍是 **in-memory 的 `MemorySaver`**

---

## 5. 模型配置与环境变量

### 5.1 `.env.example`

当前示例环境变量只有：

```bash
OPENAI_API_KEY=your-openai-compatible-api-key-here
OPENAI_BASE_URL=https://api.example.com/v1
OPENAI_MODEL=gpt-5.4
```

### 5.2 模型工厂实现

`src/model.ts`：

- 所有模型都通过 `ChatOpenAI` 创建
- 如果设置了 `OPENAI_BASE_URL`，就会作为 OpenAI-compatible provider / proxy 使用
- 默认模型名是 `gpt-5.4`

### 5.3 文件解析模型

`resumeIngestAgent` 使用的是：

```ts
createFileIngestModel()
```

这个工厂会打开：

```ts
useResponsesApi: true
```

因此 PDF 简历解析依赖：

- OpenAI-compatible provider
- Responses API
- 文件输入能力

如果所接入的网关 / 代理不支持这些能力，`resume_ingest_agent` 相关流程会失败。

---

## 6. 主状态模型（MissionState）

主状态定义在 `src/types.ts` 的 `MissionStateSchema`。

## 6.1 字段列表

```ts
{
  missionId: string,
  missionGoal: string,
  jdSourceType?: "text" | "url",
  jdSourceValue?: string,
  jdText: string,
  baseResumeMarkdown?: string,
  artifacts: ArtifactRegistry,
  reviews: ReviewRegistry,
  pendingHumanConfirmation: PendingHumanConfirmation,
}
```

### 6.2 字段语义

#### `missionId`
Mission 唯一标识。

#### `missionGoal`
Mission 的业务目标描述。

#### `jdSourceType`
JD 来源类型：

- `text`
- `url`

#### `jdSourceValue`
原始 JD 输入值。

- 如果 `jdSourceType = text`，这里是原始文本
- 如果 `jdSourceType = url`，这里是原始 URL

#### `jdText`
规范化后的 JD 正文。

这是后续岗位分析的基础输入。

#### `baseResumeMarkdown`
基础简历正文。

当前语义是：

- 从 PDF 简历解析出来
- 经过 `resume_ingest_agent` 整理后的 Markdown 文本
- 供后续简历策略阶段复用

#### `artifacts`
正式产物仓库。

当前支持：

- `jobAnalysis`
- `resumeStrategy`
- `tailoredResume`
- `interviewPack`

#### `reviews`
正式审查结果仓库。

当前支持对以下目标做 review：

- `jobAnalysis`
- `resumeStrategy`
- `tailoredResume`
- `interviewPack`

#### `pendingHumanConfirmation`
人工确认状态。

结构：

```ts
{
  active: boolean,
  reason?: string,
  targetArtifactType?: ArtifactType,
  question?: string,
}
```

---

## 7. Artifact / Review 数据结构

## 7.1 ArtifactSlot

`artifacts.xxx` 的值结构：

```ts
{
  markdown: string,
  updatedAt: string,
  hash: string,
  sourceAgent?: string,
  notes: string[]
}
```

### 字段说明

- `markdown`：正式正文
- `updatedAt`：更新时间（ISO 字符串）
- `hash`：内容 sha256
- `sourceAgent`：生成来源
- `notes`：补充说明

## 7.2 CriticVerdict

review 的结构：

```ts
{
  overall: "pass" | "revise" | "block",
  markdown: string,
  summary: string,
  strengths: string[],
  risks: string[],
  missingFacts: string[],
  nextActions: string[]
}
```

### 语义

- `pass`：当前版本可继续流程或导出
- `revise`：仍需修改，不能直接当最终版本导出
- `block`：存在关键问题，不能继续自动推进

---

## 8. 子 agent 拓扑

当前共有 4 个子 agent，全部定义在 `src/subagents.ts`。

## 8.1 `resumeIngestAgent`

### 模型
- `createFileIngestModel()`
- OpenAI-compatible
- `useResponsesApi: true`

### 输入来源
- PDF 文件内容（通过 `HumanMessage` + `contentBlocks` 文件块输入）

### 输出 schema
- `ResumeIngestOutputSchema`

### 输出字段

```ts
{
  markdown: string,
  quality: "high" | "medium" | "low",
  warnings: string[]
}
```

### 职责
- 把 PDF 简历忠实整理成 Markdown
- 不做候选人画像
- 不做 JD 匹配
- 不做润色

---

## 8.2 `jobScoutAgent`

### 模型
- `createDefaultModel()`

### 输出 schema
- `JobScoutReportSchema`

### 输出字段

```ts
{
  markdown: string,
  title: string,
  summary: string,
  mustHave: string[],
  niceToHave: string[],
  risks: string[],
  hiddenSignals: string[],
  questionsForUser: string[]
}
```

### 职责
- 只理解 JD
- 只产出岗位分析
- 不处理候选人画像
- 不导出

---

## 8.3 `resumeStrategistAgent`

### 模型
- `createDefaultModel()`

### 输出 schema
- `ResumeStrategyOutputSchema`

### 输出字段

```ts
{
  markdown: string,
  missingFacts: string[],
  assumptions: string[]
}
```

### 职责
- 基于 JD + 岗位分析 + 基础简历正文生成简历策略
- 不生成最终简历正文
- 不做审查

---

## 8.4 `criticAgent`

### 模型
- `createDefaultModel()`

### 输出 schema
- `CriticVerdictSchema`

### 职责
- 审查正式产物
- 返回结构化 verdict
- 不修稿
- 不导出

---

## 9. 主 agent（mainAgent）

定义在 `src/agent.ts`。

```ts
export const mainAgent = createAgent({
  name: "mainAgent",
  description: "负责推进 OfferPilot 求职 Mission 主流程的总控 Agent。",
  model: createDefaultModel(),
  tools: TOOLS,
  checkpointer: new MemorySaver(),
  systemPrompt: MAIN_AGENT_SYSTEM_PROMPT,
  stateSchema: MissionStateSchema,
});
```

### 9.1 当前特点

- 使用 `createAgent`
- 绑定所有 tools
- 有明确的 state schema
- 使用 `MemorySaver`
- **当前没有配置 middleware**

### 9.2 这意味着什么

当前主 agent 的调度行为，主要来自：

1. `systemPrompt`
2. tool 的名字与 description
3. tool 本身的前置条件 / 报错
4. workflow tool（`prepare_resume_strategy`）

而不是 middleware / tool gating。

---

## 10. 当前暴露给主 agent 的工具清单

在 `src/tools.ts` 的 `TOOLS` 数组中，当前顺序如下：

1. `extract_jd_text`
2. `ingest_resume_from_url`
3. `prepare_resume_strategy`
4. `update_artifact`
5. `update_review`
6. `request_human_confirmation`
7. `clear_human_confirmation`
9. `job_scout_agent`
10. `resume_strategist_agent`
11. `critic_agent`

下面逐个说明。

---

## 11. 工具详解

## 11.1 `extract_jd_text`

### 输入

```ts
{
  source: string,
  sourceType?: "text" | "url"
}
```

### 行为

- 如果 `sourceType` 未传：
  - 通过 `isProbablyUrl()` 自动判断是 URL 还是文本
- 如果是 URL：
  - `fetchUrlText(url)` 抓取页面
  - HTML 会经过 `htmlToText()` 做最小清洗
- 如果是文本：
  - `normalizePlainText()` 清洗

### 副作用

写入：

- `jdSourceType`
- `jdSourceValue`
- `jdText`

并追加一条 tool message。

### 备注

当前 JD 提取器只处理：

- 纯文本
- 网页 URL

**没有实现 JD PDF / DOCX 解析。**

---

## 11.2 `ingest_resume_from_url`

### 输入

```ts
{
  url: string,
  fileName?: string,
  userInstruction?: string
}
```

### 行为

1. `downloadResumePdf()` 下载文件
2. 限制大小：**10MB 内**
3. 校验：
   - content-type
   - 文件名后缀
4. 将 PDF 转为 base64
5. 通过 `HumanMessage({ contentBlocks: [...] })` 把 PDF 文件送给 `resumeIngestAgent`
6. 要求 `resumeIngestAgent` 输出 `ResumeIngestOutputSchema`
7. 清洗 markdown
8. 保存到 `baseResumeMarkdown`

### 副作用

写入：

- `baseResumeMarkdown`

并追加一条 tool message，包含：

- `quality`
- `warnings`
- `fileName`
- `mimeType`
- `size`
- `chars`

### 当前限制

- 只支持 **PDF URL**
- 不支持 DOCX
- 下载超时：20 秒
- 文件大小上限：10MB

### 对 Next.js 的直接影响

如果 Next.js 负责上传简历文件，当前后端/agent 这边期待的不是 base64 消息，而是：

- 一个 **可下载的 PDF URL**

并由 tool 自己再去下载。

---

## 11.3 `prepare_resume_strategy`（当前默认 workflow）

这是当前项目最关键的高层工具。

### 输入

```ts
{
  strategyInstruction?: string,
  jobAnalysisInstruction?: string,
  refreshJobAnalysis?: boolean
}
```

### 它解决的问题

它不是单一步骤工具，而是一个**确定性 workflow**。

它把下面这条依赖链编码到工具内部：

1. 简历策略依赖岗位分析
2. 岗位分析依赖 JD
3. 简历策略还依赖基础简历正文

### 内部执行顺序

#### Step 1：读取前置条件

- `requireJdText(...)`
- `requireResumeContext(...)`

如果没有 JD 或基础简历正文，这个 workflow 会直接失败。

#### Step 2：确保 `jobAnalysis` 可用

- 如果 `artifacts.jobAnalysis` 已存在，默认复用
- 如果不存在，或者 `refreshJobAnalysis = true`：
  - 调 `invokeJobScoutAgent(...)`
  - 生成岗位分析
  - 直接写入 `artifacts.jobAnalysis`

#### Step 3：生成 `resumeStrategy`

- 调 `invokeResumeStrategistAgent(...)`
- 使用输入：
  - `jdText`
  - `jobAnalysis.markdown`
  - `baseResumeMarkdown`
- 生成简历策略
- 直接写入 `artifacts.resumeStrategy`

#### Step 4：回写结果

tool message 里返回：

- `jobAnalysisStatus: generated | reused`
- `jobAnalysisUpdatedAt`
- `jobAnalysisHash`
- `jobAnalysisSummary?`
- `resumeStrategyUpdatedAt`
- `resumeStrategyHash`
- `missingFacts`
- `assumptions`

### 关键事实

**这是当前项目里唯一一个明确把“先岗位分析、再简历策略”固定成代码顺序的地方。**

这也是当前项目中“workflow 化”的核心实现。

---

## 11.4 `update_artifact`

### 输入

```ts
{
  artifactType: ArtifactType,
  markdown: string,
  sourceAgent?: string,
  notes?: string[]
}
```

### 行为

- 清洗 markdown
- 生成 `updatedAt`
- 生成 `hash`
- 写入 `artifacts[artifactType]`

### 备注

虽然主 prompt 里把它描述成“正式产物唯一写入口”，但**从当前实现来看，这个说法已经不是完全严格成立**。

因为：

- `prepare_resume_strategy` 也会直接写 `artifacts.jobAnalysis`
- `prepare_resume_strategy` 也会直接写 `artifacts.resumeStrategy`

所以：

> **当前代码事实是：`update_artifact` 是一个正式写入口，但不是唯一写入口。**

这个点对后续 AI 非常重要，不要只相信 prompt 文案。

---

## 11.5 `update_review`

### 输入

```ts
{
  targetArtifactType: ReviewTargetArtifactType,
  verdict: CriticVerdict
}
```

### 行为

- 校验 `verdict`
- 写入 `reviews[targetArtifactType]`

### 备注

`critic_agent` 本身只返回 verdict；要持久化，还需要显式调用 `update_review`。

---

## 11.6 `request_human_confirmation`

### 输入

```ts
{
  question: string,
  reason: string,
  targetArtifactType?: ArtifactType
}
```

### 行为

将：

```ts
pendingHumanConfirmation = {
  active: true,
  question,
  reason,
  targetArtifactType
}
```

---

## 11.7 `clear_human_confirmation`

### 行为

将：

```ts
pendingHumanConfirmation = { active: false }
```

---

## 11.9 `job_scout_agent`（tool 封装）

### 输入

```ts
{
  userInstruction?: string
}
```

### 行为

- 读取规范化 JD
- 调用 `jobScoutAgent`
- 返回 `JobScoutReport`

### 重要事实

这个 tool **只返回结果，不会自动保存到 `artifacts.jobAnalysis`**。

如果主 agent 走的是这条低层路径，仍需要：

- 再调用 `update_artifact`

### 当前定位

现在它被 prompt 和 description 定位为：

- **手动 / 高级路径**
- 单独查看、重做岗位分析时使用

而不是默认 workflow。

---

## 11.10 `resume_strategist_agent`（tool 封装）

### 输入

```ts
{
  userInstruction?: string
}
```

### 行为

- 要求 JD 已存在
- 要求 `jobAnalysis` 已存在
- 要求 `baseResumeMarkdown` 已存在
- 调用 `resumeStrategistAgent`
- 返回 `ResumeStrategyOutput`

### 重要事实

它**只返回结果，不自动写入 `artifacts.resumeStrategy`**。

如果主 agent 走低层路径，还需要：

- 再调 `update_artifact`

### 防呆逻辑

如果当前没有岗位分析，会直接报：

> 还没有可用的岗位分析。若当前目标是拿到简历策略，请优先调用 prepare_resume_strategy。

### 当前定位

- 手动 / 高级路径
- 不是默认入口

---

## 11.11 `critic_agent`（tool 封装）

### 输入

```ts
{
  targetArtifactType: "jobAnalysis" | "resumeStrategy" | "tailoredResume" | "interviewPack",
  reviewInstruction?: string
}
```

### 行为

- 通过 `buildCriticContext(...)` 拼装审查上下文
- 调用 `criticAgent`
- 返回 `CriticVerdict`

### 它不会做的事

- 不自动写 review

所以如果要持久化：

- 需要 `update_review`
- 当前代码里没有单独的 `criticReport` artifact 沉淀链路

---

## 12. 默认流程（基于当前代码）

## 12.1 JD 输入流程

### 场景
用户提供：

- JD 文本
- 或 JD URL

### 正确流程

1. `extract_jd_text`
2. 得到规范化 `jdText`

---

## 12.2 PDF 简历输入流程

### 场景
用户提供：

- PDF 简历 URL

### 正确流程

1. `ingest_resume_from_url`
2. tool 下载 PDF
3. `resume_ingest_agent` 解析 PDF
4. 保存 `baseResumeMarkdown`

---

## 12.3 简历策略生成流程（当前默认）

### 场景
用户目标是“拿到简历策略”

### 正确默认流程

1. 确保 `jdText` 已存在
2. 确保 `baseResumeMarkdown` 已存在
3. 调 `prepare_resume_strategy`
4. `prepare_resume_strategy` 内部：
   - 若无岗位分析，先生成 `jobAnalysis`
   - 再生成 `resumeStrategy`
   - 将两者沉淀到 `artifacts`

### 这是当前推荐给主 agent 的默认路径

---

## 12.4 审查流程

### 场景
用户需要审查一个正式产物

### 正确流程

1. `critic_agent(targetArtifactType=...)`
2. 返回 `CriticVerdict`
3. `update_review`

---


## 13. prompt 层面的当前编排策略

主 prompt 当前已经明确表达：

- `prepare_resume_strategy` 是默认 workflow
- `job_scout_agent` / `resume_strategist_agent` 是 manual path
- 如果用户目标依赖固定前置步骤，优先选 workflow，而不是自由组合子步骤

### 但必须注意

当前 `mainAgent` **没有配置 middleware**。

所以虽然 prompt 已经更清楚，但仍然是：

- 主要依赖 prompt 与 tool description 引导主 agent
- 再辅以 `prepare_resume_strategy` 这种代码级 workflow 封装

也就是说，当前系统已经比纯 prompt 编排更稳，但还没有做到通过 middleware 动态隐藏工具或硬性 gating。

---

## 14. 与 Next.js 集成时最重要的事实

这一节是给下一个 AI / 开发者最关键的部分。

## 14.1 当前仓库**没有 Next.js 代码**

当前仓库里：

- 没有 `app/`
- 没有 `pages/`
- 没有 API routes
- 没有 `src/server.ts`

但 `package.json` 里有：

- `dev:server`
- `start:server`

它们都指向 `src/server.ts`，而这个文件**当前并不存在**。

### 结论

> 当前代码仓库还没有真正的 HTTP / server adapter 层。

所以 Next.js 接入时，必须自行决定其中一种方式：

1. **直接调用 LangGraph / LangGraph API 暴露的 graph**
2. **在本仓库新增 server 层**，包装 `agent.invoke(...)`
3. **在 Next.js 自己的后端层直接引入并调用这个 agent**

当前代码没有帮你做完这件事。

---

## 14.2 Next.js 要给 agent 的最小输入

### 生成简历策略的前置条件

当前后端逻辑要求：

1. `jdText` 可用
2. `baseResumeMarkdown` 可用

所以 Next.js 如果要驱动“生成简历策略”，至少要完成两件事：

#### A. 提供 JD
可选两种方式：

- 直接传 JD 文本
- 传 JD URL

#### B. 提供简历 PDF URL
当前最适配的方案是：

1. Next.js 把 PDF 上传到 OSS / 对象存储
2. 拿到一个 agent 进程可访问的 URL（可下载）
3. 让 agent / tool 调用 `ingest_resume_from_url`

### 不要做的事

当前后端设计并不是让前端把 PDF base64 大段塞进普通聊天上下文。

---

## 14.3 对 Next.js 最稳的业务路径

如果 Next.js 想要稳定拿到“简历策略”，最稳的方式不是让用户发一大段自然语言，然后完全交给主 agent 自己调度。

更稳的业务拆法应该是：

### Step 1
让系统确保 JD 已落好

### Step 2
让系统确保基础简历正文已落好

### Step 3
调用 / 触发 `prepare_resume_strategy`

### Step 4
从最终状态里读：

- `artifacts.jobAnalysis`
- `artifacts.resumeStrategy`

### Step 5（可选）
触发 `critic_agent + update_review`



---

## 14.4 Next.js 最不应该依赖的东西

后续 AI 写 Next.js 时，**不要依赖以下不稳定接口**：

1. 不要依赖 README
   - 当前 README 仍是 starter 模板，和实际业务架构不一致

2. 不要只依赖自然语言 prompt 理解流程
   - 简历策略已经有 `prepare_resume_strategy` 这个默认 workflow

3. 不要从聊天历史反推正式产物
   - 当前系统设计就是把正式数据沉淀到状态里

4. 不要假设 `resume_strategist_agent` 能单独成功
   - 它依赖岗位分析和基础简历正文

---

## 15. 当前代码中的已知限制 / 风险 / 不一致点

这一节非常重要，因为交给别的 AI 时，它最容易在这些地方误判。

## 15.1 README 与实际项目已经不一致

当前 `README.md` 仍然像 starter 模板，里面描述的是：

- calculator
- weather
- search
- generic middleware examples

而当前真实代码已经是求职 Mission 项目。

### 结论

> 后续 AI 不应把 README 当成真实系统架构依据。

---

## 15.2 `package.json` 引用了不存在的 `src/server.ts`

脚本存在：

- `dev:server`
- `start:server`

但仓库里没有 `src/server.ts`。

### 结论

> 当前项目缺少一个正式的 server / HTTP adapter。

---

## 15.3 `src/index.ts` 不是完整 happy path

当前 `src/index.ts`：

- `initialState.baseResumeMarkdown = undefined`
- 但问题里又要求走 `prepare_resume_strategy`

而 `prepare_resume_strategy` 明确依赖基础简历正文。

### 结论

> 按当前代码，`src/index.ts` 这个 demo 并不是一个真实可运行的“完整简历策略 happy path 示例”，除非先补上基础简历正文。

---

## 15.4 Prompt 与实现存在轻微不一致

主 prompt 里仍然写着：

- `update_artifact 是正式产物的唯一写入口`

但从实现看：

- `prepare_resume_strategy` 会直接写 `artifacts.jobAnalysis`
- `prepare_resume_strategy` 会直接写 `artifacts.resumeStrategy`

### 结论

> 以后如果要继续演进，最好统一“提示词叙述”和“真实代码行为”。

---

## 15.5 还没有 middleware/tool gating

虽然 prompt 已经把 workflow 设为默认路径，但当前 `createAgent` 没有 middleware，因此没有做到：

- 动态隐藏不该出现的工具
- 在 model call 前强制 gating
- 在 tool call 前做统一拦截

### 结论

> 当前可靠性提升主要来自 workflow 封装，而不是 middleware 级硬约束。

---

## 15.6 简历文件输入只支持 PDF

当前 `ingest_resume_from_url`：

- 只支持 PDF
- 只接受 URL
- 限制 10MB

### 不支持

- DOCX
- 直接文本简历上传工具
- base64 通过普通消息传入

---

## 15.7 当前没有候选人画像层

当前 state 里没有：

- `candidateProfile`

也没有单独的“从简历抽候选人画像”的 agent/tool。

当前简历策略阶段依赖的是：

- `baseResumeMarkdown`
- `jobAnalysis`
- `jdText`

### 结论

如果后面要做更复杂的匹配 / 解释 / 画像，当前系统还需要再加一层。

---

## 16. 给负责 Next.js 的 AI 的明确交接建议

下面这些建议是根据**当前代码事实**给出的，不是未来规划。

## 16.1 先不要假设存在 HTTP API

因为当前仓库没有现成 server adapter。

所以 Next.js 侧如果要开工，必须先明确：

- 是直连 LangGraph API
- 还是新增一个后端 adapter 层

这一步不能跳过。

---

## 16.2 先围绕“状态快照”设计前端，不要围绕聊天文本设计

当前系统真正有业务价值的数据都在：

- `jdText`
- `baseResumeMarkdown`
- `artifacts`
- `reviews`
- `pendingHumanConfirmation`

所以前端应该围绕这些结构化数据设计，而不是只显示 assistant 文本。

---

## 16.3 关键按钮 / 关键动作建议直接对应 workflow/tool

从当前后端能力出发，Next.js 最自然的用户动作应该是：

- 导入 JD
- 导入 PDF 简历
- 生成简历策略（走 `prepare_resume_strategy`）
- 审查简历策略
- 导出产物

而不是让用户每次都走完全自由的聊天式调度。

---

## 16.4 若追求稳定，前端不要默认依赖“自由 chat 驱动所有编排”

当前代码已经在往 workflow 化方向走。对 Next.js 来说，更稳的做法是：

- 聊天作为补充交互层
- 关键业务路径作为结构化动作 / 显式流程入口

---

## 17. 当前系统的一句话总结

> 当前 `react-agent-js` 是一个基于 LangChain `createAgent` 的、面向求职 Mission 的有状态 Agent 系统；它已经具备 JD 提取、PDF 简历解析、岗位分析、简历策略生成、产物审查与导出 gating 等核心能力，其中“简历策略生成”已被封装为一个默认 workflow（`prepare_resume_strategy`），用于保证“先岗位分析、再简历策略”的固定顺序。

---

## 18. 如果后续 AI 只想抓最关键事实，请看这一页摘要

### 当前默认业务主路径

1. `extract_jd_text`
2. `ingest_resume_from_url`
3. `prepare_resume_strategy`
4. `critic_agent + update_review`

### 当前最关键的结构化数据

- `jdText`
- `baseResumeMarkdown`
- `artifacts.jobAnalysis`
- `artifacts.resumeStrategy`
- `reviews.*`
- `pendingHumanConfirmation`

### 当前最关键的 workflow

- `prepare_resume_strategy`
  - 自动保证：**先岗位分析，再简历策略**

### 当前最关键的限制

- 没有 Next.js / HTTP 层
- 没有 `src/server.ts`
- 只支持 PDF 简历 URL
- 没有 middleware gating
- README 已经过时

---

如果这份文档后面要继续维护，建议优先和以下文件保持同步：

- `src/tools.ts`
- `src/types.ts`
- `src/prompts.ts`
- `src/agent.ts`
- `src/subagents.ts`
