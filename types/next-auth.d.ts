import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "CANDIDATE" | "INTERVIEWER" | "ADMIN";
    } & DefaultSession["user"];
  }

  interface User {
    role: "CANDIDATE" | "INTERVIEWER" | "ADMIN";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: "CANDIDATE" | "INTERVIEWER" | "ADMIN";
  }
}