import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  MAX_CLIP_SECONDS,
  parseYouTubeVideoId,
} from "@/lib/shared";

export type VideoMetadata = {
  title: string;
  duration: number;
  thumbnail: string;
  videoId: string;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}

export async function assertBinaryExists(binary: "yt-dlp" | "ffmpeg") {
  try {
    await runCommand(binary, ["--version"]);
  } catch {
    throw new Error(
      `${binary} is not installed or not available in PATH. Please install ${binary} before running this app.`,
    );
  }
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
  const videoId = parseYouTubeVideoId(url);
  if (!videoId) {
    throw new UserInputError("Please provide a valid YouTube URL.");
  }

  const { stdout } = await runCommand("yt-dlp", [
    "--dump-single-json",
    "--no-warnings",
    "--no-playlist",
    `https://www.youtube.com/watch?v=${videoId}`,
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

  return {
    title: data.title,
    duration: data.duration,
    thumbnail:
      data.thumbnail ?? `https://i.ytimg.com/vi/${data.id}/hqdefault.jpg`,
    videoId: data.id,
  };
}

export async function createClipFromYouTube(options: {
  url: string;
  startSeconds: number;
  endSeconds: number;
}): Promise<{ outputFilePath: string; cleanup: () => Promise<void> }> {
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
    await runCommand("yt-dlp", [
      "--no-warnings",
      "--no-playlist",
      "-f",
      "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
      "--merge-output-format",
      "mp4",
      "-o",
      sourceTemplatePath,
      `https://www.youtube.com/watch?v=${metadata.videoId}`,
    ]);

    const sourceFilePath = await resolveDownloadedSourceFile(workspaceDir);

    await runCommand("ffmpeg", [
      "-y",
      "-ss",
      String(options.startSeconds),
      "-to",
      String(options.endSeconds),
      "-i",
      sourceFilePath,
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
    ]);

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

export async function readFileAsBuffer(filePath: string): Promise<Buffer> {
  return readFile(filePath);
}
