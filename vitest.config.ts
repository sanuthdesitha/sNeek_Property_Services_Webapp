import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "e2e", "sneek-nextgen"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**", "components/**", "app/**"],
      exclude: ["**/*.test.*", "**/node_modules/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // server-only throws if imported outside a Server Component bundle; make it
      // a no-op in tests so server modules (e.g. the tenant-isolation engine) load.
      "server-only": path.resolve(__dirname, "tests/__stubs__/server-only.ts"),
    },
  },
});
