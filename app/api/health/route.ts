import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: { database: "ok" | "unavailable"; aiProvider: "ok" | "unavailable" } = {
    database: "unavailable",
    aiProvider: "unavailable",
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch (error) {
    console.error("Health check: database unavailable", error);
  }

  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const configuredModel = process.env.OLLAMA_MODEL || "qwen2.5:3b";
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (response.ok) {
      const data = (await response.json()) as { models?: { name?: string }[] };
      const modelAvailable = (data.models ?? []).some(
        (model) =>
          model.name === configuredModel ||
          model.name?.startsWith(`${configuredModel}:`),
      );
      if (modelAvailable) checks.aiProvider = "ok";
    }
  } catch {
    // Keep the health response compact; do not expose internal error details.
  }

  const healthy = checks.database === "ok" && checks.aiProvider === "ok";
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      service: "human-ai-interview",
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: healthy ? 200 : 503 },
  );
}
