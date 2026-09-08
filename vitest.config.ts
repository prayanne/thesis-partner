import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@thesis/security": path.resolve("packages/security/src/index.ts"),
      "@thesis/providers": path.resolve("packages/providers/src/index.ts"),
      "@thesis/contracts": path.resolve("packages/contracts/src/index.ts"),
      "@thesis/db": path.resolve("packages/db/src/index.ts"),
      "@thesis/domain": path.resolve("packages/domain/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts"],
    testTimeout: 15000,
  },
});
