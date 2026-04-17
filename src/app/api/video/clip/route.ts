import { NextRequest } from "next/server";
import {
  assertBinaryExists,
  createClipFromYouTube,
  readFileAsBuffer,
  toDownloadName,
  UserInputError,
} from "@/lib/youtube";
import { parseYouTubeVideoId } from "@/lib/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let cleanup: (() => Promise<void>) | null = null;

  try {
    await assertBinaryExists("yt-dlp");
    await assertBinaryExists("ffmpeg");

    const body = (await request.json()) as {
      url?: string;
      startSeconds?: number;
      endSeconds?: number;
    };

    if (!body.url || typeof body.startSeconds !== "number" || typeof body.endSeconds !== "number") {
      return Response.json({ error: "URL, startSeconds and endSeconds are required." }, { status: 400 });
    }

    if (!parseYouTubeVideoId(body.url)) {
      return Response.json({ error: "Please provide a valid YouTube URL." }, { status: 400 });
    }

    const clipResult = await createClipFromYouTube({
      url: body.url,
      startSeconds: body.startSeconds,
      endSeconds: body.endSeconds,
    });

    cleanup = clipResult.cleanup;

    const clipBuffer = await readFileAsBuffer(clipResult.outputFilePath);
    const responseBytes = new Uint8Array(clipBuffer);
    await cleanup();
    cleanup = null;

    return new Response(responseBytes, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": clipBuffer.byteLength.toString(),
        "Content-Disposition": `attachment; filename="${toDownloadName(clipResult.outputFilePath)}"`,
      },
    });
  } catch (error) {
    if (cleanup) {
      await cleanup();
    }

    if (error instanceof UserInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const message =
      error instanceof Error
        ? error.message
        : "Unable to create clip. Please try again.";

    return Response.json({ error: message }, { status: 500 });
  }
}
