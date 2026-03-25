import { ChatOpenAI } from "@langchain/openai";

function getBaseOpenAIConfig() {
  return {
    model: process.env.OPENAI_MODEL ?? "gpt-5.4",
    apiKey: process.env.OPENAI_API_KEY,
    configuration: process.env.OPENAI_BASE_URL
      ? {
          baseURL: process.env.OPENAI_BASE_URL,
        }
      : undefined,
      useResponsesApi: true,
      reasoning_effort: 'medium',
  };
}

export function createDefaultModel() {
  return new ChatOpenAI(getBaseOpenAIConfig());
}

export function createFileIngestModel() {
  return new ChatOpenAI({
    ...getBaseOpenAIConfig(),
    useResponsesApi: true,
  });
}
