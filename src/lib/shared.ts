export const MAX_CLIP_SECONDS = 5 * 60;

export const CLIP_RESOLUTIONS = ["source", "1080p", "720p", "480p", "360p"] as const;

export type ClipResolution = (typeof CLIP_RESOLUTIONS)[number];

export function isClipResolution(value: unknown): value is ClipResolution {
  return typeof value === "string" && CLIP_RESOLUTIONS.includes(value as ClipResolution);
}

export function parseYouTubeVideoId(input: string): string | null {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const host = url.hostname.replace("www.", "").toLowerCase();

  if (host === "youtube.com" || host === "m.youtube.com") {
    const pathSegments = url.pathname.split("/").filter(Boolean);

    if (pathSegments[0] === "shorts") {
      const id = pathSegments[1] ?? "";
      return isValidVideoId(id) ? id : null;
    }

    const id = url.searchParams.get("v");
    return isValidVideoId(id) ? id : null;
  }

  if (host === "youtu.be") {
    const path = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return isValidVideoId(path) ? path : null;
  }

  return null;
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }

  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function parseTimestamp(value: string): number | null {
  const cleaned = value.trim();

  if (!cleaned) {
    return null;
  }

  const parts = cleaned.split(":").map((part) => Number(part));

  if (parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return null;
  }

  if (parts.length === 1) {
    return parts[0];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
}

function isValidVideoId(value: string | null): value is string {
  if (!value) {
    return false;
  }

  return /^[A-Za-z0-9_-]{11}$/.test(value);
}
