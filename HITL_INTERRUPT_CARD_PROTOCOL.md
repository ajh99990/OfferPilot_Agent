# HITL 前端对接文档

本文档用于交接当前 `react-agent-js` 的 HITL 协议。  
前端需要做的不是“解析 JSON 让用户手输”，而是识别 interrupt payload，然后渲染合适的卡片 UI。

## 当前结论

后端现在统一支持两类卡片：

- `approval_card`
- `questionnaire_card`

当前已经真正接入业务流程的是：

- `kind = "tailored_resume_direction_confirmation"`
- `ui = "approval_card"`

它会在生成 `tailoredResume` 之前固定出现，标题叫“确认定制方向”。
实际业务时序已经拆成两步：

1. `prepare_tailored_resume` 或 `prepare_interview_pack` 先沉淀上游产物
2. 如果方向尚未确认，主 agent 再调用 `confirm_tailored_resume_direction`
3. 这个 tool 才会真正触发 interrupt 卡片

另外，联调测试工具 `request_simple_human_confirmation` 现在也复用了同一套 `approval_card` 渲染器，只是内容更简单。

## 前端要做什么

前端需要实现一个统一的 interrupt renderer：

1. 如果识别到 `ui === "approval_card"`，渲染审批卡片
2. 如果识别到 `ui === "questionnaire_card"`，渲染问卷卡片
3. 如果都不认识，回退到通用 JSON 输入框

这样后续增加新的 HITL 场景时，不需要再为每个场景重写一套基础交互。

## 相关后端代码

- 协议 schema：`src/types.ts`
- interrupt 构造与恢复解析：`src/tools/invokers.ts`
- 默认工作流入口：`src/tools/definitions.ts`

重点关注：

- `ApprovalCardInterruptSchema`
- `QuestionnaireCardInterruptSchema`
- `BinaryConfirmationResumeSchema`
- `buildTailoredResumeDirectionApprovalInterrupt(...)`
- `interruptForTailoredResumeDirectionConfirmation(...)`

## approval_card 协议

### interrupt payload

```ts
type ApprovalCardInterrupt = {
  version: 1;
  kind: string;
  ui: "approval_card";
  title: string;
  summary: string;
  sections: Array<{
    title: string;
    items: string[];
  }>;
  question?: string;
  options: [
    { id: "approve"; label: string },
    { id: "reject"; label: string }
  ];
  metadata?: Record<string, unknown>;
};
```

字段说明：

- `title`
  卡片标题，前端直接展示

- `summary`
  卡片顶部摘要，一般是一段高密度说明

- `sections`
  主体内容分区，适合渲染成 1 到多块列表

- `question`
  最后一行明确问题，可选

- `options`
  按钮定义。前端应优先使用这里的 label，不要硬编码

- `metadata`
  用于埋点、调试或业务扩展，通常不直接展示

### resume payload

前端点击按钮后，推荐用下面的结构恢复运行：

```ts
type BinaryConfirmationResume = {
  approved: boolean;
  decisionId?: "approve" | "reject";
  source?: "approval_card" | "questionnaire_card" | "json_editor";
};
```

推荐发送：

点击“继续”：

```json
{
  "approved": true,
  "decisionId": "approve",
  "source": "approval_card"
}
```

点击“拒绝”：

```json
{
  "approved": false,
  "decisionId": "reject",
  "source": "approval_card"
}
```

## 当前业务卡片：确认定制方向

### 触发时机

当后端已经沉淀好当前版本的 `jobAnalysis / resumeStrategy`，并且准备继续生成新的 `tailoredResume` 时，`confirm_tailored_resume_direction` 会抛出这张卡片。

这意味着：

- 用户走 `prepare_tailored_resume` 时，如果工具结果里出现 `requiresDirectionConfirmation=true`，主 agent 应继续调用 `confirm_tailored_resume_direction`
- 用户直接走手动 `tailored_resume_agent` 时，如果当前方向尚未确认，也会看到它
- 用户走 `prepare_interview_pack`，但系统需要先生成新的 `tailoredResume` 时，也会先进入同一张卡片

### 当前 payload 形状

```ts
{
  version: 1,
  kind: "tailored_resume_direction_confirmation",
  ui: "approval_card",
  title: "确认定制方向",
  summary: "岗位分析和简历策略已经准备好。确认后，系统会按当前方向生成定制简历。",
  sections: [
    {
      title: "岗位判断",
      items: ["..."]
    },
    {
      title: "当前定制方向",
      items: ["...", "..."]
    },
    {
      title: "当前假设",
      items: ["..."]
    },
    {
      title: "仍待确认的信息",
      items: ["..."]
    }
  ],
  question: "是否按这个方向继续生成定制简历？",
  options: [
    { id: "approve", label: "继续生成" },
    { id: "reject", label: "我想调整方向" }
  ],
  metadata: {
    targetArtifactType: "tailoredResume",
    sourceTool: "confirm_tailored_resume_direction"
  }
}
```

### 前端推荐展示方式

卡片建议包含：

- 标题
- 顶部摘要
- 分区列表
- 最后一行问题
- 两个按钮

建议按钮：

- 主按钮：`继续生成`
- 次按钮：`我想调整方向`

### 用户点击后的行为

点击“继续生成”：

```ts
resume({
  approved: true,
  decisionId: "approve",
  source: "approval_card",
});
```

点击“我想调整方向”：

```ts
resume({
  approved: false,
  decisionId: "reject",
  source: "approval_card",
});
```

后端当前行为：

- `approved = true`：继续生成 `tailoredResume`
- `approved = false`：停止本次生成，run 结束为错误/中断终止态

所以前端在用户点“我想调整方向”后，最好同步引导用户补一句自然语言，例如：

- “请把项目经历弱化一些”
- “我更想突出 AI Agent 方向”
- “这份策略里有几条假设不对”

## request_simple_human_confirmation 如何接

这个测试工具现在也走 `approval_card`，只是 payload 更简单：

```ts
{
  version: 1,
  kind: "...",
  ui: "approval_card",
  title: "...",
  summary: "...",
  sections: [],
  options: [
    { id: "approve", label: "是" },
    { id: "reject", label: "否" }
  ]
}
```

也就是说：

- 不需要额外做第二套简单卡片组件
- 直接复用 `approval_card` 组件即可
- 如果 `sections` 为空，就只展示 `title + summary + buttons`

## questionnaire_card 协议

当前代码里已经预留了 `questionnaire_card`，但默认流程还没有正式接入。

### interrupt payload

```ts
type QuestionnaireCardInterrupt = {
  version: 1;
  kind: string;
  ui: "questionnaire_card";
  title: string;
  summary?: string;
  fields: Array<{
    id: string;
    label: string;
    helpText?: string;
    placeholder?: string;
    required: boolean;
    multiline: boolean;
  }>;
  submitLabel?: string;
  metadata?: Record<string, unknown>;
};
```

### resume payload

```ts
type QuestionnaireCardResume = {
  answers: Record<string, string>;
  source?: "questionnaire_card";
};
```

前端现在可以先把它做出来，但当前联调重点是 `approval_card`。

## 前端识别逻辑

建议做两个类型守卫：

```ts
function isApprovalCardInterrupt(value: unknown): boolean
function isQuestionnaireCardInterrupt(value: unknown): boolean
```

最稳的最小判断：

```ts
record &&
typeof record === "object" &&
record.ui === "approval_card"
```

和：

```ts
record &&
typeof record === "object" &&
record.ui === "questionnaire_card"
```

## 回退策略

必须保留 fallback：

- 识别到 `approval_card` -> 渲染审批卡片
- 识别到 `questionnaire_card` -> 渲染问卷卡片
- 其余未知 interrupt -> 回退到 JSON 编辑器

这样后端以后新增场景时，前端不会直接失效。

## 为什么前端必须自己渲染卡片

因为 LangGraph 的 `interrupt()` 只会：

1. 暂停流程
2. 抛出结构化 payload
3. 等前端/调用方恢复

它不会替你生成按钮 UI。  
默认看到的 JSON 输入框，通常只是通用调试界面的兜底渲染。

## 官方资料

- LangGraph interrupts:
  https://docs.langchain.com/oss/javascript/langgraph/interrupts
- Frontend human-in-the-loop:
  https://docs.langchain.com/oss/javascript/langchain/frontend/human-in-the-loop#how-interrupts-work
- LangSmith server API HITL example:
  https://docs.langchain.com/langsmith/add-human-in-the-loop#extended-example-using-`interrupt`

## 推荐前端实现顺序

1. 先做 `approval_card` 渲染器
2. 接上 `tailored_resume_direction_confirmation`
3. 把 `request_simple_human_confirmation` 也切到同一套渲染器
4. 最后再补 `questionnaire_card`
