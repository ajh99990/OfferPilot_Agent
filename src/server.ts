import "dotenv/config";
import { createServer } from "node:http";
import { agent } from "./agent.js";

type ChatRequestBody = {
  message?: string;
  messages?: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
};

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN ?? "http://localhost:3000";

function setCorsHeaders(res: import("node:http").ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(
  res: import("node:http").ServerResponse,
  statusCode: number,
  payload: unknown
) {
  setCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(
  req: import("node:http").IncomingMessage
): Promise<ChatRequestBody> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw) as ChatRequestBody;
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: "Invalid request" });
    return;
  }

  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "langchain-agent-starter",
      model: process.env.OPENAI_MODEL ?? "gpt-5.4",
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    try {
      const body = await readJsonBody(req);
      const incomingMessages = Array.isArray(body.messages)
        ? body.messages.filter(
            (item) => item && typeof item.role === "string" && typeof item.content === "string"
          )
        : undefined;

      const message = typeof body.message === "string" ? body.message.trim() : "";

      const messages =
        incomingMessages && incomingMessages.length > 0
          ? incomingMessages
          : message
            ? [{ role: "user" as const, content: message }]
            : [];

      if (messages.length === 0) {
        sendJson(res, 400, { error: "message or messages is required" });
        return;
      }

      const result = await agent.invoke({ messages });
      const finalMessage = result.messages.at(-1);
      const text = typeof finalMessage?.content === "string"
        ? finalMessage.content
        : Array.isArray(finalMessage?.content)
          ? finalMessage.content
              .map((part) => {
                if (typeof part === "string") return part;
                if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
                  return part.text;
                }
                return "";
              })
              .join("\n")
          : "";

      sendJson(res, 200, {
        text,
        message: finalMessage ?? null,
        messages: result.messages,
      });
    } catch (error) {
      console.error("Chat request failed:", error);
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Unknown server error",
      });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`🚀 Agent service listening on http://${HOST}:${PORT}`);
  console.log(`💬 POST http://localhost:${PORT}/api/chat`);
  console.log(`❤️  GET  http://localhost:${PORT}/health`);
});
