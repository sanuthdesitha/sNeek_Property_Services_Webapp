import { createReadStream, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Prisma, PrismaClient } from "@prisma/client";
import S3 from "aws-sdk/clients/s3";

type Args = {
  outputDir: string;
  includeUploads: boolean;
  uploadOffsite: boolean;
  jsonOnly: boolean;
  skipDb: boolean;
  jsonExport: boolean;
  retentionDays: number;
  keepExtracted: boolean;
};

type BackupManifest = {
  createdAt: string;
  host: string;
  nodeVersion: string;
  appUrl: string | null;
  outputDir: string;
  warnings: string[];
  database: {
    pgDumpCreated: boolean;
    pgDumpFile: string | null;
    jsonExportDir: string;
    modelCounts: Record<string, number>;
  };
  uploads: {
    included: boolean;
    downloadedCount: number;
    bucket: string | null;
    folder: string | null;
  };
  offsite: {
    uploaded: boolean;
    bucket: string | null;
    key: string | null;
  };
  archive: {
    created: boolean;
    file: string | null;
  };
};

function parseArgs(argv: string[]): Args {
  const outputArg = argv.find((arg) => arg.startsWith("--output-dir="));
  const retentionArg = argv.find((arg) => arg.startsWith("--retention-days="));
  const parsedRetention = retentionArg
    ? Number(retentionArg.slice("--retention-days=".length))
    : 3;
  return {
    outputDir: outputArg ? outputArg.slice("--output-dir=".length) : "backups",
    includeUploads: argv.includes("--include-uploads"),
    uploadOffsite: argv.includes("--upload-offsite"),
    jsonOnly: argv.includes("--json-only"),
    skipDb: argv.includes("--skip-db"),
    jsonExport: argv.includes("--json-export"),
    retentionDays: Number.isFinite(parsedRetention) && parsedRetention >= 0 ? parsedRetention : 3,
    keepExtracted: argv.includes("--keep-extracted"),
  };
}

function nowStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${y}${m}${day}-${h}${min}${sec}`;
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

async function exportDatabaseJson(prisma: PrismaClient, outDir: string, timeoutMs = 20_000) {
  await fs.mkdir(outDir, { recursive: true });
  const modelCounts: Record<string, number> = {};
  const warnings: string[] = [];

  for (const model of Prisma.dmmf.datamodel.models) {
    const delegateName = `${model.name[0].toLowerCase()}${model.name.slice(1)}`;
    const delegate = (prisma as any)[delegateName];
    if (!delegate || typeof delegate.findMany !== "function") {
      continue;
    }
    try {
      const rows = await Promise.race<any[]>([
        delegate.findMany(),
        new Promise<any[]>((_, reject) =>
          setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
      modelCounts[model.name] = rows.length;
      const filePath = path.join(outDir, `${model.name}.json`);
      await fs.writeFile(filePath, JSON.stringify(rows, null, 2), "utf8");
    } catch (error: any) {
      warnings.push(`Model ${model.name} export skipped: ${error?.message ?? "unknown error"}`);
    }
  }

  return { modelCounts, warnings };
}

async function downloadUploads(s3: S3, bucket: string, outDir: string) {
  await fs.mkdir(outDir, { recursive: true });
  let token: string | undefined;
  let downloaded = 0;

  do {
    const result = await s3
      .listObjectsV2({
        Bucket: bucket,
        ContinuationToken: token,
      })
      .promise();

    const contents = result.Contents ?? [];
    for (const item of contents) {
      const key = item.Key;
      if (!key) continue;
      const localPath = path.join(outDir, ...key.split("/"));
      await fs.mkdir(path.dirname(localPath), { recursive: true });

      const stream = s3.getObject({ Bucket: bucket, Key: key }).createReadStream();
      await pipeline(stream, createWriteStream(localPath));
      downloaded += 1;
    }

    token = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (token);

  return downloaded;
}

async function maybeCreateArchive(rootDir: string, folderName: string, archivePath: string) {
  const hasTar = await commandExists("tar");
  if (!hasTar) return false;
  await runCommand("tar", ["-czf", archivePath, "-C", rootDir, folderName]);
  return true;
}

async function pruneOldArchives(rootDir: string, retentionDays: number): Promise<{ deleted: string[]; failed: string[] }> {
  const deleted: string[] = [];
  const failed: string[] = [];
  if (retentionDays <= 0) return { deleted, failed };

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let entries: string[];
  try {
    entries = await fs.readdir(rootDir);
  } catch {
    return { deleted, failed };
  }

  for (const entry of entries) {
    if (!entry.startsWith("backup-") || !entry.endsWith(".tar.gz")) continue;
    const fullPath = path.join(rootDir, entry);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(fullPath);
        deleted.push(entry);
      }
    } catch (error: any) {
      failed.push(`${entry}: ${error?.message ?? "unknown error"}`);
    }
  }

  return { deleted, failed };
}

async function pruneStaleExtractedFolders(rootDir: string): Promise<string[]> {
  const removed: string[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(rootDir);
  } catch {
    return removed;
  }

  for (const entry of entries) {
    if (!entry.startsWith("backup-") || entry.endsWith(".tar.gz")) continue;
    const fullPath = path.join(rootDir, entry);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        await fs.rm(fullPath, { recursive: true, force: true });
        removed.push(entry);
      }
    } catch {
      // ignore
    }
  }

  return removed;
}

async function maybeUploadOffsite(archivePath: string) {
  const backupBucket = process.env.BACKUP_S3_BUCKET?.trim();
  if (!backupBucket) return { uploaded: false, key: null as string | null };

  const s3 = getS3Client();
  const key = `db-backups/${path.basename(archivePath)}`;
  await s3
    .upload({
      Bucket: backupBucket,
      Key: key,
      Body: createReadStream(archivePath),
      ContentType: "application/gzip",
    })
    .promise();
  return { uploaded: true, key };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const timestamp = nowStamp();
  const rootOutput = path.resolve(process.cwd(), args.outputDir);
  const folderName = `backup-${timestamp}`;
  const backupDir = path.join(rootOutput, folderName);
  const archiveFile = path.join(rootOutput, `${folderName}.tar.gz`);

  await fs.mkdir(rootOutput, { recursive: true });

  // Clean up any leftover uncompressed folders from previous runs (the script
  // never used to delete these, so they accumulate alongside the .tar.gz files).
  const stalePruned = await pruneStaleExtractedFolders(rootOutput);
  if (stalePruned.length > 0) {
    console.log(`Removed ${stalePruned.length} leftover extracted backup folder(s) from previous runs.`);
  }

  await fs.mkdir(backupDir, { recursive: true });

  const manifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    host: os.hostname(),
    nodeVersion: process.version,
    appUrl: process.env.APP_URL?.trim() || null,
    outputDir: backupDir,
    warnings: [],
    database: {
      pgDumpCreated: false,
      pgDumpFile: null,
      jsonExportDir: path.join(backupDir, "database-json"),
      modelCounts: {},
    },
    uploads: {
      included: args.includeUploads,
      downloadedCount: 0,
      bucket: process.env.S3_BUCKET_NAME?.trim() || null,
      folder: args.includeUploads ? path.join(backupDir, "uploads") : null,
    },
    offsite: {
      uploaded: false,
      bucket: process.env.BACKUP_S3_BUCKET?.trim() || null,
      key: null,
    },
    archive: {
      created: false,
      file: null,
    },
  };

  let prisma: PrismaClient | null = null;
  try {
    if (args.skipDb) {
      manifest.warnings.push("Database backup skipped (--skip-db).");
    } else {
      const canPgDump = !args.jsonOnly && (await commandExists("pg_dump"));
      if (canPgDump && process.env.DATABASE_URL) {
        const dumpFile = path.join(backupDir, "database.dump");
        await runCommand("pg_dump", [
          "--format=custom",
          "--no-owner",
          `--file=${dumpFile}`,
          process.env.DATABASE_URL,
        ]);
        manifest.database.pgDumpCreated = true;
        manifest.database.pgDumpFile = dumpFile;
      } else if (!args.jsonOnly) {
        manifest.warnings.push("pg_dump not found. Created logical JSON backup only.");
      }

      if (args.jsonExport) {
        try {
          prisma = new PrismaClient();
          await Promise.race([
            prisma.$queryRaw`SELECT 1`,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("database connectivity timeout (12s)")), 12_000)
            ),
          ]);
          const exported = await exportDatabaseJson(prisma, manifest.database.jsonExportDir);
          manifest.database.modelCounts = exported.modelCounts;
          manifest.warnings.push(...exported.warnings);
        } catch (error: any) {
          manifest.warnings.push(`Database JSON export skipped: ${error?.message ?? "database not reachable"}`);
        } finally {
          if (prisma) {
            await prisma.$disconnect();
            prisma = null;
          }
        }
      }
    }

    if (args.includeUploads) {
      const bucket = process.env.S3_BUCKET_NAME?.trim();
      if (!bucket) {
        manifest.warnings.push("S3_BUCKET_NAME not configured. Upload media backup skipped.");
      } else {
        const s3 = getS3Client();
        manifest.uploads.downloadedCount = await downloadUploads(
          s3,
          bucket,
          manifest.uploads.folder ?? path.join(backupDir, "uploads")
        );
      }
    }

    await fs.writeFile(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    manifest.archive.created = await maybeCreateArchive(rootOutput, folderName, archiveFile);
    manifest.archive.file = manifest.archive.created ? archiveFile : null;

    if (args.uploadOffsite) {
      if (!manifest.archive.created || !manifest.archive.file) {
        manifest.warnings.push("Archive not created, offsite upload skipped.");
      } else {
        const offsite = await maybeUploadOffsite(manifest.archive.file);
        manifest.offsite.uploaded = offsite.uploaded;
        manifest.offsite.key = offsite.key;
      }
    }

    await fs.writeFile(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    // Delete the extracted backup folder once the .tar.gz exists. The folder is
    // pure duplication of the archive contents and was the main cause of the
    // /app/backups directory ballooning in size.
    let extractedRemoved = false;
    if (manifest.archive.created && !args.keepExtracted) {
      try {
        await fs.rm(backupDir, { recursive: true, force: true });
        extractedRemoved = true;
      } catch (error: any) {
        manifest.warnings.push(`Could not remove extracted folder ${backupDir}: ${error?.message ?? "unknown error"}`);
      }
    }

    // Enforce retention on .tar.gz archives.
    const pruneResult = await pruneOldArchives(rootOutput, args.retentionDays);
    for (const failure of pruneResult.failed) {
      manifest.warnings.push(`Archive prune failed: ${failure}`);
    }

    console.log("");
    console.log("Backup completed");
    if (extractedRemoved) {
      console.log(`- Extracted folder removed (kept archive only).`);
    } else {
      console.log(`- Backup folder: ${backupDir}`);
    }
    if (manifest.archive.created && manifest.archive.file) {
      console.log(`- Archive: ${manifest.archive.file}`);
    }
    if (pruneResult.deleted.length > 0) {
      console.log(`- Pruned ${pruneResult.deleted.length} archive(s) older than ${args.retentionDays} day(s): ${pruneResult.deleted.join(", ")}`);
    }
    console.log(`- JSON export models: ${Object.keys(manifest.database.modelCounts).length}`);
    console.log(`- Upload objects downloaded: ${manifest.uploads.downloadedCount}`);
    if (manifest.warnings.length > 0) {
      console.log("- Warnings:");
      for (const warning of manifest.warnings) {
        console.log(`  - ${warning}`);
      }
    }
  } finally {
    const prismaClient = prisma as PrismaClient | null;
    if (prismaClient) {
      await prismaClient.$disconnect();
    }
  }
}

main().catch((error) => {
  console.error("Backup failed:", error);
  process.exit(1);
});
