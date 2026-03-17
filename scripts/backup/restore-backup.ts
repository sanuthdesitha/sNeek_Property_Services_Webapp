import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import S3 from "aws-sdk/clients/s3";

type Args = {
  backupDir: string;
  confirm: boolean;
  restoreUploads: boolean;
};

function parseArgs(argv: string[]): Args {
  const backupDirArg = argv.find((arg) => arg.startsWith("--backup-dir="));
  return {
    backupDir: backupDirArg ? backupDirArg.slice("--backup-dir=".length) : "",
    confirm: argv.includes("--confirm"),
    restoreUploads: argv.includes("--restore-uploads"),
  };
}

async function commandExists(command: string) {
  const checker = process.platform === "win32" ? "where" : "which";
  return new Promise<boolean>((resolve) => {
    const child = spawn(checker, [command], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

function getS3Client() {
  return new S3({
    endpoint: process.env.S3_ENDPOINT,
    s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false",
    region: process.env.S3_REGION ?? "auto",
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
    signatureVersion: "v4",
  });
}

async function uploadDirectoryToS3(localRoot: string, bucket: string) {
  const s3 = getS3Client();
  const allFiles: string[] = [];

  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(next);
      } else {
        allFiles.push(next);
      }
    }
  }

  await walk(localRoot);
  for (const file of allFiles) {
    const key = path.relative(localRoot, file).replace(/\\/g, "/");
    await s3
      .upload({
        Bucket: bucket,
        Key: key,
        Body: createReadStream(file),
      })
      .promise();
  }
  return allFiles.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.confirm) {
    throw new Error("Refusing to run without --confirm.");
  }
  if (!args.backupDir) {
    throw new Error("Missing --backup-dir argument.");
  }

  const backupDir = path.resolve(process.cwd(), args.backupDir);
  const dumpPath = path.join(backupDir, "database.dump");
  const dumpExists = await fs
    .stat(dumpPath)
    .then(() => true)
    .catch(() => false);

  if (dumpExists) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set for restore.");
    }
    const canRestore = await commandExists("pg_restore");
    if (!canRestore) {
      throw new Error("pg_restore not found in PATH. Install PostgreSQL client tools first.");
    }

    await runCommand("pg_restore", [
      "--clean",
      "--if-exists",
      "--no-owner",
      `--dbname=${process.env.DATABASE_URL}`,
      dumpPath,
    ]);
    console.log("Database restore completed from database.dump.");
  } else {
    console.log("No database.dump found. Skipping DB restore.");
    console.log("Logical JSON backups are kept for manual forensic recovery only.");
  }

  if (args.restoreUploads) {
    const uploadsDir = path.join(backupDir, "uploads");
    const uploadsExists = await fs
      .stat(uploadsDir)
      .then(() => true)
      .catch(() => false);
    const bucket = process.env.S3_BUCKET_NAME?.trim();
    if (!uploadsExists) {
      console.log("No uploads folder found in backup. Skipping upload restore.");
    } else if (!bucket) {
      throw new Error("S3_BUCKET_NAME is required to restore uploads.");
    } else {
      const count = await uploadDirectoryToS3(uploadsDir, bucket);
      console.log(`Uploads restore completed. Uploaded ${count} objects to ${bucket}.`);
    }
  }
}

main().catch((error) => {
  console.error("Restore failed:", error);
  process.exit(1);
});
