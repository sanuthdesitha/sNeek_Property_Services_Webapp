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
      // Server modules (lib/db.ts et al) start with `import "server-only"`.
      // Next special-cases it at build time to stop server code leaking into a
      // client bundle — a guard we keep. The real npm package deliberately
      // THROWS anywhere outside a React Server Component, which would break
      // every test that transitively imports lib/db. Point it at a harmless
      // no-op for tests only; the app build is unaffected.
      "server-only": path.resolve(__dirname, "scripts/_stubs/server-only.ts"),
    },
  },
});
