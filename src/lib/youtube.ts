import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  ClipResolution,
  getSupportedVideoPlatform,
  MAX_CLIP_SECONDS,
  parseTikTokVideoId,
  parseYouTubeVideoId,
  SupportedVideoPlatform,
} from "@/lib/shared";

export type VideoMetadata = {
  title: string;
  duration: number;
  thumbnail: string;
  platform: SupportedVideoPlatform;
  videoId: string | null;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

const BINARY_PATH_OVERRIDES: Record<"yt-dlp" | "ffmpeg", string[]> = {
  "yt-dlp": [
    process.env.YT_DLP_PATH ?? "",
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
  ],
  ffmpeg: [
    process.env.FFMPEG_PATH ?? "",
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
  ],
};

export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}

export const createClipFromYouTube = createClipFromVideoUrl;

function getScaleFilter(resolution: ClipResolution | undefined): string | null {
  if (!resolution || resolution === "source") {
    return null;
  }

  const maxHeightMap: Record<Exclude<ClipResolution, "source">, number> = {
    "1080p": 1080,
    "720p": 720,
    "480p": 480,
    "360p": 360,
  };

  const maxHeight = maxHeightMap[resolution];
  return `scale='min(iw,${maxHeight}*a/1)':'min(ih,${maxHeight})':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
}

export async function assertBinaryExists(binary: "yt-dlp" | "ffmpeg") {
  await resolveBinaryPath(binary);
}

export function validateClipRange(startSeconds: number, endSeconds: number, duration: number) {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
    throw new UserInputError("Start and end time must be valid numbers.");
  }

  if (startSeconds < 0) {
    throw new UserInputError("Start time cannot be negative.");
  }

  if (endSeconds <= startSeconds) {
    throw new UserInputError("End time must be greater than start time.");
  }

  if (endSeconds > duration) {
    throw new UserInputError("End time cannot exceed video duration.");
  }

  if (endSeconds - startSeconds > MAX_CLIP_SECONDS) {
    throw new UserInputError(`Clips are limited to ${MAX_CLIP_SECONDS / 60} minutes for MVP.`);
  }
}

export async function getVideoMetadata(url: string): Promise<VideoMetadata> {
  const ytDlpBinary = await resolveBinaryPath("yt-dlp");
  const platform = getSupportedVideoPlatform(url);
  if (!platform) {
    throw new UserInputError("Please provide a valid YouTube or TikTok URL.");
  }

  const { stdout } = await runCommand(ytDlpBinary, [
    "--dump-single-json",
    "--no-warnings",
    "--no-playlist",
    url,
  ]);

  const data = JSON.parse(stdout) as {
    title?: string;
    duration?: number;
    thumbnail?: string;
    id?: string;
  };

  if (!data.title || !data.duration || !data.id) {
    throw new Error("Unable to read video metadata.");
  }

  const videoId =
    platform === "youtube"
      ? parseYouTubeVideoId(url) ?? data.id
      : parseTikTokVideoId(url) ?? data.id;

  const fallbackThumbnail =
    platform === "youtube" && videoId
      ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      : "";

  return {
    title: data.title,
    duration: data.duration,
    thumbnail: data.thumbnail ?? fallbackThumbnail,
    platform,
    videoId,
  };
}

export async function createClipFromVideoUrl(options: {
  url: string;
  startSeconds: number;
  endSeconds: number;
  resolution?: ClipResolution;
}): Promise<{ outputFilePath: string; cleanup: () => Promise<void> }> {
  const ytDlpBinary = await resolveBinaryPath("yt-dlp");
  const ffmpegBinary = await resolveBinaryPath("ffmpeg");
  const metadata = await getVideoMetadata(options.url);
  validateClipRange(options.startSeconds, options.endSeconds, metadata.duration);

  const workspaceRoot = join(tmpdir(), "yt-clipper");
  await mkdir(workspaceRoot, { recursive: true });
  const workspaceDir = await mkdtemp(join(workspaceRoot, "job-"));

  const sourceTemplatePath = join(workspaceDir, "source.%(ext)s");
  const clipPath = join(workspaceDir, `${safeFilename(metadata.title)}-${randomUUID()}.mp4`);

  const cleanup = async () => {
    await rm(workspaceDir, { recursive: true, force: true });
  };

  try {
    await runCommand(ytDlpBinary, [
      "--no-warnings",
      "--no-playlist",
      "-f",
      "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
      "--merge-output-format",
      "mp4",
      "-o",
      sourceTemplatePath,
      options.url,
    ]);

    const sourceFilePath = await resolveDownloadedSourceFile(workspaceDir);

    const ffmpegArgs = [
      "-y",
      "-ss",
      String(options.startSeconds),
      "-to",
      String(options.endSeconds),
      "-i",
      sourceFilePath,
    ];

    const scaleFilter = getScaleFilter(options.resolution);
    if (scaleFilter) {
      ffmpegArgs.push("-vf", scaleFilter);
    }

    ffmpegArgs.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      clipPath,
    );

    await runCommand(ffmpegBinary, ffmpegArgs);

    return { outputFilePath: clipPath, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export function toDownloadName(filePath: string): string {
  return basename(filePath);
}

async function resolveDownloadedSourceFile(workspaceDir: string): Promise<string> {
  const expectedFiles = ["source.mp4", "source.webm", "source.mkv"];

  for (const file of expectedFiles) {
    const fullPath = join(workspaceDir, file);
    try {
      await access(fullPath, constants.F_OK);
      return fullPath;
    } catch {
      // Keep trying expected source file names.
    }
  }

  throw new Error("Downloaded source file was not found.");
}

function safeFilename(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9\-_\s]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60)
    .toLowerCase();
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited with code ${code}. ${stderr || stdout}`));
    });
  });
}

async function resolveBinaryPath(binary: "yt-dlp" | "ffmpeg"): Promise<string> {
  const candidates = [binary, ...BINARY_PATH_OVERRIDES[binary]].filter((value) => value.length > 0);
  const versionArgs = binary === "ffmpeg" ? ["-version"] : ["--version"];

  for (const candidate of candidates) {
    try {
      await runCommand(candidate, versionArgs);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  const envHint = binary === "ffmpeg" ? "FFMPEG_PATH" : "YT_DLP_PATH";
  throw new Error(
    `${binary} is not installed or not available in PATH. Please install ${binary} before running this app. You can also set ${envHint} to an absolute binary path.`,
  );
}

export async function readFileAsBuffer(filePath: string): Promise<Buffer> {
  return readFile(filePath);
}
