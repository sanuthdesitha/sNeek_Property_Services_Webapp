// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const source = readFileSync("scripts/run-next.cjs", "utf8");
function launch(args: string[], env: Record<string, string> = {}) {
  const spawnSync = vi.fn(() => ({ status: 0 }));
  const runtime = {
    argv: ["node", "scripts/run-next.cjs", "start", ...args],
    env,
    cwd: () => process.cwd(),
    execPath: process.execPath,
    exit: vi.fn(),
  };
  new Function("require", "process", source)(
    (name: string) =>
      name === "node:child_process" ? { spawnSync } : require(name),
    runtime,
  );
  return spawnSync.mock.calls[0] as unknown as [
    string,
    string[],
    { env: Record<string, string> },
  ];
}
it.each([
  [[], {}, "3000"],
  [["-H", "0.0.0.0", "-p", "3023"], { PORT: "9000" }, "3023"],
  [["--port", "4010"], {}, "4010"],
  [[], { PORT: "4011" }, "4011"],
] as Array<[string[], Record<string, string>, string]>)(
  "uses the actual server port for internal session validation",
  (args, env, port) => {
    const [, , options] = launch(args, env);
    expect(options.env.NEXTAUTH_URL_INTERNAL).toBe(`http://127.0.0.1:${port}`);
    expect(env).not.toHaveProperty("NEXTAUTH_URL_INTERNAL");
  },
);
it("preserves explicitly configured internal transport and public auth URL", () => {
  const [, , options] = launch([], {
    NEXTAUTH_URL_INTERNAL: "http://web:3000",
    NEXTAUTH_URL: "https://example.invalid",
  });
  expect(options.env.NEXTAUTH_URL_INTERNAL).toBe("http://web:3000");
  expect(options.env.NEXTAUTH_URL).toBe("https://example.invalid");
});
it.each(["0", "65536", "bad", ""])(
  "refuses an invalid local port: %s",
  (port) => {
    expect(() => launch(["-p", port])).toThrow("Invalid Next server port");
  },
);
