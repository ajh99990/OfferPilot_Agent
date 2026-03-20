/**
 * LangChain Agent - Entry Point
 *
 * This file provides a simple CLI interface for testing the agent locally.
 * Run with: pnpm start
 */

import "dotenv/config";
import { agent } from "./agent.js";

console.log("🤖 LangChain Agent Started\n");
console.log("Ask me anything! I can:");
console.log("  • Perform calculations");
console.log("  • Tell you the current time");
console.log("  • Check the weather (simulated)");
console.log("  • Search the knowledge base\n");

// Example conversation
const questions = [
  "你好！你能做什么？",
  "What's the weather like in San Francisco?",
  "Calculate 42 * 17 + 100",
];

for (const question of questions) {
  console.log(`📝 User: ${question}\n`);

  try {
    const result = await agent.invoke({
      messages: [{ role: "user", content: question }],
    });

    // The result contains the agent's response
    console.log(`🤖 Agent: ${result.messages.at(-1)?.content}\n`);
    console.log("─".repeat(50) + "\n");
  } catch (error) {
    console.error("Error:", error);
  }
}
