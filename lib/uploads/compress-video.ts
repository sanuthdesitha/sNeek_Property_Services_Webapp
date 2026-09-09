import type { Conversion } from "mediabunny";

export function isVideoFile(file: Pick<File, "name" | "type">): boolean {
  return file.type.toLowerCase().startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv|3gp|mpe?g)$/i.test(file.name);
}

/** Decode from disk and, where available, write to private browser storage. */
export async function compressVideo(file: File, options: {
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
} = {}): Promise<{ file: File; dispose: () => Promise<void> }> {
  const { signal, onProgress } = options;
  signal?.throwIfAborted();
  const media = await import("mediabunny");
  const input = new media.Input({ source: new media.BlobSource(file), formats: media.ALL_FORMATS });
  let directory: FileSystemDirectoryHandle | undefined;
  let handle: FileSystemFileHandle | undefined;
  let writable: FileSystemWritableFileStream | undefined;
  const temporaryName = `video-${crypto.randomUUID()}.mp4`;
  const dispose = async () => {
    await writable?.abort().catch(() => {});
    await directory?.removeEntry(temporaryName).catch(() => {});
  };
  let conversion: Conversion | undefined;
  const cancel = () => { void conversion?.cancel().catch(() => {}); };
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("This file has no readable video track.");
    signal?.throwIfAborted();
    // OPFS avoids holding a long compressed walkthrough in the phone's heap.
    try {
      directory = await navigator.storage.getDirectory();
      handle = await directory.getFileHandle(temporaryName, { create: true });
      writable = await handle.createWritable();
    } catch {
      await dispose();
      handle = undefined;
      writable = undefined;
    }
    const target = writable ? new media.StreamTarget(writable) : new media.BufferTarget();
    const output = new media.Output({ format: new media.Mp4OutputFormat(), target });
    const scale = Math.min(1, 1280 / Math.max(track.displayWidth, track.displayHeight));
    conversion = await media.Conversion.init({
      input, output,
      video: {
        width: Math.max(2, Math.round(track.displayWidth * scale / 2) * 2),
        height: Math.max(2, Math.round(track.displayHeight * scale / 2) * 2),
        fit: "contain", codec: "avc", quality: new media.Quality("medium"),
        forceTranscode: true,
      },
    });
    // Never silently drop an unsupported audio or video track from evidence.
    if (!conversion.isValid || conversion.discardedTracks.length > 0) {
      throw new Error("This browser cannot compress this video with all its tracks. Try an MP4 video or a newer browser.");
    }
    signal?.addEventListener("abort", cancel, { once: true });
    signal?.throwIfAborted();
    conversion.onProgress = (progress) => onProgress?.(Math.round(progress * 100));
    await conversion.execute();
    signal?.throwIfAborted();
    const blob = handle ? await handle.getFile() : new Blob([(target as InstanceType<typeof media.BufferTarget>).buffer!], { type: "video/mp4" });
    if (!blob.size) throw new Error("Video compression produced an empty file. Please retry.");
    const compressed = new File([blob], file.name.replace(/\.[^.]+$/, "") + ".mp4", { type: "video/mp4", lastModified: file.lastModified });
    return { file: compressed.size < file.size ? compressed : file, dispose };
  } catch (error) {
    await conversion?.cancel().catch(() => {});
    await dispose();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    input.dispose();
  }
}
