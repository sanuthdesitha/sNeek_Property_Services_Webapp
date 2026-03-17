import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";

export interface CompressVideoResult {
  outputPath: string;
  stderr: string;
}

export async function compressVideoToMp4(inputPath: string, outputPath: string): Promise<CompressVideoResult> {
  const executable = typeof ffmpegPath === "string" ? ffmpegPath : process.env.FFMPEG_PATH;
  if (!executable) {
    throw new Error("FFmpeg executable is not available.");
  }

  const args = [
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    "scale='min(1280,iw)':-2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "30",
    "-maxrate",
    "1500k",
    "-bufsize",
    "3000k",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  let stderr = "";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });

  return { outputPath, stderr };
}
