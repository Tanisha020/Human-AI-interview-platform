import { createHmac, timingSafeEqual } from "node:crypto";

export type SocketTicketRole = "CANDIDATE" | "INTERVIEWER" | "ADMIN";

export type SocketTicketClaims = {
  userId: string;
  role: SocketTicketRole;
  roomId: string;
  expiresAt: number;
};

function getSocketTicketSecret(): string {
  const secret =
    process.env.SOCKET_AUTH_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET;

  if (!secret) {
    throw new Error("Set SOCKET_AUTH_SECRET or AUTH_SECRET for Socket.IO authentication.");
  }

  return secret;
}

export function createSocketTicket(input: {
  userId: string;
  role: SocketTicketRole;
  roomId: string;
}): string {
  const claims: SocketTicketClaims = {
    ...input,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", getSocketTicketSecret())
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

export function verifySocketTicket(ticket: unknown): SocketTicketClaims | null {
  if (typeof ticket !== "string") return null;

  const [payload, signature, extra] = ticket.split(".");
  if (!payload || !signature || extra) return null;

  try {
    const expected = createHmac("sha256", getSocketTicketSecret())
      .update(payload)
      .digest();
    const received = Buffer.from(signature, "base64url");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      return null;
    }

    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as SocketTicketClaims;

    if (
      !claims.userId ||
      !claims.roomId ||
      !["CANDIDATE", "INTERVIEWER", "ADMIN"].includes(claims.role) ||
      !Number.isFinite(claims.expiresAt) ||
      claims.expiresAt <= Date.now()
    ) {
      return null;
    }

    return claims;
  } catch {
    return null;
  }
}
