import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { createAgent } from "langchain";
import { createDefaultModel } from "./model.js";
import { MAIN_AGENT_SYSTEM_PROMPT } from "./prompts.js";
import { TOOLS } from "./tools/index.js";
import { MissionStateSchema } from "./types.js";

const checkpointer = new MemorySaver();

export const mainAgent = createAgent({
  name: "mainAgent",
  description: "负责推进 OfferPilot 求职 Mission 主流程的总控 Agent。",
  model: createDefaultModel(),
  tools: TOOLS,
  checkpointer,
  systemPrompt: MAIN_AGENT_SYSTEM_PROMPT,
  stateSchema: MissionStateSchema,
});

export const agent = mainAgent;
