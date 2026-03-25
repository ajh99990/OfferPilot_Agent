import "dotenv/config";
import { agent } from "./agent.js";
import type { MissionState } from "./types.js";

function renderContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object" && "text" in item) {
          const text = item.text;
          return typeof text === "string" ? text : JSON.stringify(item, null, 2);
        }

        return JSON.stringify(item, null, 2);
      })
      .join("\n");
  }

  if (content == null) {
    return "";
  }

  return JSON.stringify(content, null, 2);
}

const sampleJd = `高级前端工程师（AI Agent 方向）

岗位职责：
1. 负责 AI 求职产品的前端架构设计与核心页面开发。
2. 负责复杂表单、富文本编辑器、工作流编排界面等模块落地。
3. 与产品、设计、后端、算法协作，推动需求上线并持续优化体验。
4. 关注工程化质量、性能优化、稳定性与可维护性。

岗位要求：
1. 5 年及以上前端经验，熟悉 React、TypeScript。
2. 做过复杂中后台或 SaaS 产品。
3. 有良好的抽象设计能力、协作能力和业务理解能力。
4. 能把模糊需求落成可迭代交付方案。

加分项：
1. 有 AI 产品、低代码、可视化编辑器、国际化项目经验。
2. 有面向真实业务的 Agent 或工作流系统经验。`;

const initialState: MissionState = {
  missionId: "local-job-mission-demo",
  missionGoal: "围绕 AI Agent 方向前端岗位准备求职材料",
  jdText: "",
  jdSourceType: undefined,
  jdSourceValue: undefined,
  baseResumeMarkdown: undefined,
  tailoredResume: undefined,
  interviewPack: undefined,
  artifacts: {},
  reviews: {},
  pendingHumanConfirmation: {
    active: false,
  },
  tailoredResumeDirectionConfirmation: {},
};

const question = `请你把下面这个 JD 当作一次 Mission 输入，并严格按既定链路推进：

${sampleJd}

要求：
1. 先调用 extract_jd_text，保存规范化后的 canonical JD；
2. 再走 prepare_tailored_resume 这个默认工作流；
3. 在生成 tailoredResume 之前，如果出现“确认定制方向”卡片，就停在 interrupt 等待确认；
4. 如果没有被 interrupt，用中文总结当前流程里已经沉淀的正式数据，并说明是否已经生成 tailoredResume。`;

console.log("🎯 OfferPilot AgentOS 本地示例启动\n");
console.log(`📝 用户问题：\n${question}\n`);

try {
  const rawResult = await agent.invoke(
    {
      ...initialState,
      messages: [{ role: "user", content: question }],
    } as Parameters<typeof agent.invoke>[0],
    {
      configurable: {
        thread_id: "local-job-mission-thread",
      },
    }
  );

  const result = rawResult as typeof rawResult & MissionState;

  console.log(`🤖 主 Agent：\n${renderContent(result.messages.at(-1)?.content)}\n`);
  console.log("🗂️ 当前流程快照：");
  console.log(
    JSON.stringify(
      {
        jdSourceType: result.jdSourceType,
        jdSourceValue: result.jdSourceValue,
        hasJdText: Boolean(result.jdText),
        hasTailoredResume: Boolean(result.tailoredResume),
        artifacts: result.artifacts,
        reviews: result.reviews,
        pendingHumanConfirmation: result.pendingHumanConfirmation,
      },
      null,
      2
    )
  );
} catch (error) {
  console.error("运行失败：", error);
}
