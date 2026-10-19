import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Tests share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
