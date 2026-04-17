# YouTube Clipper (MVP)

Local-first web app to clip a specific timerange from a YouTube video and download it as MP4.

Built with Next.js (App Router) and Node.js route handlers.

## Features

- Paste a YouTube URL and fetch metadata (title, duration, thumbnail)
- Preview the video in-app before clipping
- Choose clip range with sliders and `mm:ss` inputs
- Set start/end from the current playback time
- Download clipped output as MP4
- Temporary server-side file workspace with cleanup

## Tech Stack

- Next.js 16 (App Router)
- TypeScript
- `yt-dlp` for media retrieval
- `ffmpeg` for clipping/transcoding

## Prerequisites

Install the following binaries on your machine and ensure they are available in your PATH:

- `yt-dlp`
- `ffmpeg`

### macOS (Homebrew)

```bash
brew install yt-dlp ffmpeg
```

Verify installation:

```bash
yt-dlp --version
ffmpeg -version
```

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm run dev
```

3. Open:

`http://localhost:3000`

## How to Use

1. Paste a valid YouTube URL.
2. Click **Load Video**.
3. Use sliders and/or `mm:ss` inputs to set start/end.
4. Optionally use **Set Start from Current** / **Set End from Current** while previewing.
5. Click **Download Clip** to generate and download MP4.

## API Overview

### `POST /api/video/metadata`

Input:

```json
{ "url": "https://www.youtube.com/watch?v=..." }
```

Output:

```json
{
  "title": "Video title",
  "duration": 372,
  "thumbnail": "https://...",
  "videoId": "abcdefghijk"
}
```

### `POST /api/video/clip`

Input:

```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "startSeconds": 15,
  "endSeconds": 62
}
```

Response: MP4 file stream/download.

## Current MVP Limits

- MP4 output only
- Max clip length: 5 minutes
- Local usage only (no auth, no cloud job queue)

## Troubleshooting

- `yt-dlp is not installed or not available in PATH`
  - Install with Homebrew (`brew install yt-dlp`) and restart the dev server.
- `ffmpeg is not installed or not available in PATH`
  - Install with Homebrew (`brew install ffmpeg`) and restart the dev server.

## Open Source Notes

- Please respect YouTube Terms of Service and copyright laws in your jurisdiction.
- This project is intended for legitimate personal workflow and educational use.

## Contributing

Issues and pull requests are welcome.

Suggested local check before opening a PR:

```bash
npm run lint
```
