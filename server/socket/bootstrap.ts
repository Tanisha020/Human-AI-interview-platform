import dotenv from "dotenv";

// Next.js reads .env.local automatically, but the standalone Socket.IO process
// does not. Load it before importing the socket server and AI provider.
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

void import("./server").catch((error) => {
  console.error("Could not start Socket.IO server:", error);
  process.exitCode = 1;
});
