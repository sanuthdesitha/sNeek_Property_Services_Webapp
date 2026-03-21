import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";

export interface CompressVideoResult {
  outputPath: string;
  stderr: string;
}

interface CompressVideoOptions {
  maxDimension?: number;
  crf?: number;
  maxRateKbps?: number;
  bufferKbps?: number;
  audioBitrateKbps?: number;
}

export async function compressVideoToMp4(
  inputPath: string,
  outputPath: string,
  options: CompressVideoOptions = {}
): Promise<CompressVideoResult> {
  const executable = typeof ffmpegPath === "string" ? ffmpegPath : process.env.FFMPEG_PATH;
  if (!executable) {
    throw new Error("FFmpeg executable is not available.");
  }

  const maxDimension = options.maxDimension ?? 960;
  const crf = options.crf ?? 34;
  const maxRateKbps = options.maxRateKbps ?? 900;
  const bufferKbps = options.bufferKbps ?? maxRateKbps * 2;
  const audioBitrateKbps = options.audioBitrateKbps ?? 64;

  const args = [
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    `scale='min(${maxDimension},iw)':-2`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "faster",
    "-crf",
    String(crf),
    "-maxrate",
    `${maxRateKbps}k`,
    "-bufsize",
    `${bufferKbps}k`,
    "-c:a",
    "aac",
    "-b:a",
    `${audioBitrateKbps}k`,
    "-map_metadata",
    "-1",
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
