import { NextRequest } from "next/server";
import {
  assertBinaryExists,
  getVideoMetadata,
  UserInputError,
} from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await assertBinaryExists("yt-dlp");

    const body = (await request.json()) as { url?: string };

    if (!body.url) {
      return Response.json({ error: "URL is required." }, { status: 400 });
    }

    const metadata = await getVideoMetadata(body.url);

    return Response.json(metadata);
  } catch (error) {
    if (error instanceof UserInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const message =
      error instanceof Error
        ? error.message
        : "Unable to fetch metadata for this video.";

    return Response.json({ error: message }, { status: 500 });
  }
}
