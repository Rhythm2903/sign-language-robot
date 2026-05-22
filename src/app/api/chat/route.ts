import { google } from "@ai-sdk/google";
import { generateText } from "ai";

export const runtime = "nodejs";
export const maxDuration = 30;

interface ChatMessage {
  role: string;
  content: string;
}

function isValidMessage(m: unknown): m is ChatMessage {
  return (
    typeof m === "object" &&
    m !== null &&
    "role" in m &&
    "content" in m &&
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string" &&
    m.content.length > 0 &&
    m.content.length <= 8000
  );
}

export async function POST(req: Request) {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return Response.json(
      {
        text: "AI is not configured. Set GOOGLE_GENERATIVE_AI_API_KEY in your environment (e.g. Vercel project settings).",
      },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const {
      messages,
      contextMode,
      performanceScore,
      targetSign,
      sessionStats,
    } = body as {
      messages?: unknown;
      contextMode?: string;
      performanceScore?: string;
      targetSign?: string;
      sessionStats?: unknown;
    };

    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 50) {
      return Response.json({ text: "Invalid request: messages required." }, { status: 400 });
    }

    if (!messages.every(isValidMessage)) {
      return Response.json({ text: "Invalid request: malformed messages." }, { status: 400 });
    }

    let systemPrompt = "";

    if (contextMode === "translation") {
      systemPrompt =
        "You are the structural translator engine of an assistive Sign Language Robot. " +
        "The user will give you a list of detected ASL sign labels. " +
        "Convert them into one grammatically correct, natural English sentence. " +
        "Output ONLY the final translated sentence — no preamble, no remarks, no explanation.";
    } else {
      const stats = sessionStats ? JSON.stringify(sessionStats) : "{}";
      systemPrompt =
        `You are ARIA — Advanced Real-time Interactive ASL Coach. You are warm, precise, encouraging, and expert.\n\n` +
        `## Current Session Context\n` +
        `- Sign being practiced: [${targetSign || "None"}]\n` +
        `- Real-time accuracy reading: ${performanceScore ?? "N/A"}\n` +
        `- Session stats: ${stats}\n\n` +
        `## Coaching Framework\n` +
        `1. Provide accuracy feedback tiers (0-39% foundational, 40-79% fine-tuning, 80-99% micro-corrections, 100% celebrate).\n` +
        `2. CRITICAL FORMATTING RULE: Whenever you reference a sign key, wrap it in curly braces: {ASL_B}, {ASL_L}.\n` +
        `Keep responses 2-4 sentences, warm, expert, and conversational.`;
    }

    const response = await generateText({
      model: google("gemini-2.5-flash"),
      messages: messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      system: systemPrompt,
    });

    return Response.json({ text: response.text });
  } catch (error) {
    console.error("API Gateway error:", error);
    return Response.json(
      { text: "Error connecting to the AI backend. Check your API key and try again." },
      { status: 500 }
    );
  }
}
