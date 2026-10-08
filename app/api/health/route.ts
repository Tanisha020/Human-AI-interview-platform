import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "human-ai-interview",
    timestamp: new Date().toISOString(),
  });
}