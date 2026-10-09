import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma CLI does not load Next.js .env.local automatically. Load it first
// so the setup instructions work on Windows and in local development.
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not defined");
}

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
  },

  datasource: {
    url: databaseUrl,
  },
});