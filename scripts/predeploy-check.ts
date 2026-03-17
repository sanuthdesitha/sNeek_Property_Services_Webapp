import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

type Args = {
  withBuild: boolean;
  skipDb: boolean;
};

function parseArgs(argv: string[]): Args {
  return {
    withBuild: argv.includes("--with-build"),
    skipDb: argv.includes("--skip-db"),
  };
}

function printCheck(label: string, ok: boolean, detail?: string) {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${label}${detail ? ` - ${detail}` : ""}`);
}

async function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
    child.on("error", reject);
  });
}

async function commandExists(command: string) {
  const checker = process.platform === "win32" ? "where" : "which";
  return new Promise<boolean>((resolve) => {
    const child = spawn(checker, [command], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function scanPotentialDeadButtons(rootDirs: string[]) {
  const findings: Array<{ file: string; line: number; content: string }> = [];
  for (const rootDir of rootDirs) {
    const absoluteRoot = path.resolve(process.cwd(), rootDir);
    const entries = await fs.readdir(absoluteRoot, { withFileTypes: true });

    const walk = async (base: string, items: Dirent[]): Promise<void> => {
      for (const item of items) {
        const nextPath = path.join(base, item.name);
        if (item.isDirectory()) {
          const nextItems = await fs.readdir(nextPath, { withFileTypes: true });
          await walk(nextPath, nextItems);
          continue;
        }
        if (!item.name.endsWith(".tsx")) continue;
        const file = await fs.readFile(nextPath, "utf8");
        const tagRegex = /<Button\b[\s\S]*?>/g;
        let match: RegExpExecArray | null;
        while ((match = tagRegex.exec(file)) !== null) {
          const tag = match[0];
          if (tag.includes("onClick=")) continue;
          if (tag.includes("asChild")) continue;
          if (tag.includes('type="submit"') || tag.includes("type='submit'")) continue;
          if (tag.includes("href=") || tag.includes("formAction=")) continue;
          const before = file.slice(0, match.index);
          const line = before.split(/\r?\n/).length;
          const firstLine = tag.split(/\r?\n/)[0]?.trim() ?? "<Button>";
          findings.push({
            file: path.relative(process.cwd(), nextPath),
            line,
            content: firstLine,
          });
        }
      }
    };

    await walk(absoluteRoot, entries);
  }
  return findings;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let failed = false;

  const requiredEnv = ["DATABASE_URL", "NEXTAUTH_SECRET"];
  for (const key of requiredEnv) {
    const value = process.env[key]?.trim();
    const ok = Boolean(value);
    printCheck(`Env ${key}`, ok, ok ? undefined : "missing");
    if (!ok) failed = true;
  }

  const appUrl = process.env.APP_BASE_URL?.trim() || process.env.APP_URL?.trim() || "";
  const hasPublicUrl = Boolean(appUrl);
  printCheck("Env APP_BASE_URL or APP_URL", hasPublicUrl, hasPublicUrl ? undefined : "missing");
  if (!hasPublicUrl) failed = true;

  if (appUrl) {
    const localhost = /localhost|127\.0\.0\.1/i.test(appUrl);
    printCheck("Public app URL non-localhost", !localhost, localhost ? appUrl : undefined);
    if (localhost) failed = true;
  }

  const hasPgDump = await commandExists("pg_dump");
  printCheck(
    "Database backup capability",
    true,
    hasPgDump
      ? "pg_dump available"
      : "pg_dump missing; logical JSON backup fallback is available (pg_dump still recommended)"
  );

  const hasTar = await commandExists("tar");
  printCheck("tar available", hasTar);

  if (args.skipDb) {
    printCheck("Database connectivity", true, "skipped (--skip-db)");
  } else {
    const prisma = new PrismaClient();
    let dbOk = false;
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout after 12s")), 12_000)),
      ]);
      dbOk = true;
    } catch (error: any) {
      printCheck("Database connectivity", false, error?.message ?? "connection failed");
      failed = true;
    } finally {
      try {
        await Promise.race([
          prisma.$disconnect(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("disconnect timeout after 5s")), 5_000)),
        ]);
      } catch (error: any) {
        printCheck("Database disconnect", false, error?.message ?? "disconnect failed");
        failed = true;
      }
    }
    if (dbOk) {
      printCheck("Database connectivity", true);
    }
  }

  const buttonFindings = await scanPotentialDeadButtons(["app", "components"]);
  const reportPath = path.resolve(process.cwd(), "predeploy-button-report.json");
  await fs.writeFile(reportPath, JSON.stringify(buttonFindings, null, 2), "utf8");
  printCheck(
    "Potential dead buttons report generated",
    true,
    `${buttonFindings.length} candidates -> ${path.basename(reportPath)}`
  );

  if (args.withBuild) {
    try {
      if (process.platform === "win32") {
        await runCommand("cmd", ["/c", "set NEXT_DIST_DIR=.next-check&& npm run build"]);
      } else {
        await runCommand("sh", ["-lc", "NEXT_DIST_DIR=.next-check npm run build"]);
      }
      printCheck("Production build", true);
    } catch (error: any) {
      printCheck("Production build", false, error?.message ?? "build failed");
      failed = true;
    }
  } else {
    printCheck("Production build", true, "skipped (run with --with-build)");
  }

  if (failed) {
    console.log("");
    console.log("Predeploy check finished with failures. Resolve FAIL checks before deployment.");
    process.exit(1);
  }

  console.log("");
  console.log("Predeploy check passed.");
}

main().catch((error) => {
  console.error("Predeploy check failed:", error);
  process.exit(1);
});
