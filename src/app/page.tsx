"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import YouTube, { YouTubeEvent } from "react-youtube";
import {
  CLIP_RESOLUTIONS,
  ClipResolution,
  formatTimestamp,
  MAX_CLIP_SECONDS,
  parseTimestamp,
  parseYouTubeVideoId,
} from "@/lib/shared";
import styles from "./page.module.css";

type VideoMetadata = {
  title: string;
  duration: number;
  thumbnail: string;
  videoId: string;
};

type UiStatus = "idle" | "fetching" | "ready" | "clipping";

export default function Home() {
  const [urlInput, setUrlInput] = useState("");
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [status, setStatus] = useState<UiStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState(0);
  const [startInput, setStartInput] = useState("00:00");
  const [endInput, setEndInput] = useState("00:30");
  const [resolution, setResolution] = useState<ClipResolution>("source");
  const [currentTime, setCurrentTime] = useState(0);
  const ytPlayerRef = useRef<{ getCurrentTime: () => number } | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const clipLength = Math.max(0, endSeconds - startSeconds);
  const hasVideoId = useMemo(() => parseYouTubeVideoId(urlInput), [urlInput]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  async function handleFetchMetadata() {
    setError(null);
    setStatus("fetching");

    try {
      const response = await fetch("/api/video/metadata", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: urlInput }),
      });

      const body = (await response.json()) as VideoMetadata | { error: string };

      if (!response.ok || "error" in body) {
        throw new Error("error" in body ? body.error : "Unable to fetch video metadata.");
      }

      setMetadata(body);
      setStartSeconds(0);
      setEndSeconds(Math.min(body.duration, 30));
      setStartInput("00:00");
      setEndInput(formatTimestamp(Math.min(body.duration, 30)));
      setCurrentTime(0);
      setStatus("ready");
    } catch (fetchError) {
      setStatus("idle");
      setMetadata(null);
      setError(fetchError instanceof Error ? fetchError.message : "Could not load video metadata.");
    }
  }

  function handleStartInput(value: string) {
    setStartInput(value);

    const parsed = parseTimestamp(value);
    if (parsed === null || !metadata) {
      return;
    }

    const next = Math.min(parsed, Math.max(0, endSeconds - 1));
    setStartSeconds(next);
    setStartInput(formatTimestamp(next));
  }

  function handleEndInput(value: string) {
    setEndInput(value);

    const parsed = parseTimestamp(value);
    if (parsed === null || !metadata) {
      return;
    }

    const safeEnd = Math.min(metadata.duration, parsed);
    const next = Math.max(safeEnd, startSeconds + 1);
    setEndSeconds(next);
    setEndInput(formatTimestamp(next));
  }

  function setTimeFromPlayer(target: "start" | "end") {
    if (!metadata) {
      return;
    }

    const time = Math.floor(ytPlayerRef.current?.getCurrentTime() ?? currentTime);

    if (target === "start") {
      const next = Math.min(time, endSeconds - 1);
      setStartSeconds(next);
      setStartInput(formatTimestamp(next));
      return;
    }

    const next = Math.max(time, startSeconds + 1);
    setEndSeconds(next);
    setEndInput(formatTimestamp(next));
  }

  async function handleDownload() {
    if (!metadata) {
      return;
    }

    setError(null);
    setStatus("clipping");

    try {
      const response = await fetch("/api/video/clip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: urlInput,
          startSeconds,
          endSeconds,
          resolution,
        }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Clip generation failed.");
      }

      const blob = await response.blob();
      const link = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = `${metadata.title.slice(0, 50).replace(/\s+/g, "-").toLowerCase()}-clip.mp4`;
      link.click();
      URL.revokeObjectURL(objectUrl);
      setStatus("ready");
    } catch (downloadError) {
      setStatus("ready");
      setError(downloadError instanceof Error ? downloadError.message : "Download failed.");
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.hero}>
          <p className={styles.kicker}>YouTube Clipper</p>
          <h1>Clip exactly what you need, then download as MP4.</h1>
          <p>Paste a YouTube link, preview it, pick your start and end, and export in one step.</p>
        </header>

        <section className={styles.panel}>
          <label className={styles.label} htmlFor="youtube-url">
            YouTube URL
          </label>
          <div className={styles.urlRow}>
            <input
              id="youtube-url"
              className={styles.input}
              placeholder="https://www.youtube.com/watch?v=..."
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
            />
            <button
              className={styles.buttonPrimary}
              onClick={handleFetchMetadata}
              disabled={!hasVideoId || status === "fetching" || status === "clipping"}
            >
              {status === "fetching" ? "Loading..." : "Load Video"}
            </button>
          </div>
          <p className={styles.helper}>Supports youtube.com and youtu.be links.</p>
          {error ? <p className={styles.error}>{error}</p> : null}
        </section>

        {metadata ? (
          <section className={styles.editor}>
            <div className={styles.previewCard}>
              <div className={styles.playerFrame}>
                <YouTube
                  videoId={metadata.videoId}
                  opts={{
                    width: "100%",
                    height: "100%",
                    playerVars: {
                      modestbranding: 1,
                      rel: 0,
                    },
                  }}
                  className={styles.youtube}
                  iframeClassName={styles.youtubeFrame}
                  onReady={(event: YouTubeEvent) => {
                    ytPlayerRef.current = event.target;
                  }}
                  onStateChange={(event: YouTubeEvent<number>) => {
                    const isPlaying = event.data === 1;

                    if (!isPlaying) {
                      if (pollTimerRef.current !== null) {
                        window.clearInterval(pollTimerRef.current);
                        pollTimerRef.current = null;
                      }
                      return;
                    }

                    if (pollTimerRef.current !== null) {
                      window.clearInterval(pollTimerRef.current);
                    }

                    pollTimerRef.current = window.setInterval(() => {
                      if (!ytPlayerRef.current) {
                        return;
                      }

                      setCurrentTime(Math.floor(ytPlayerRef.current.getCurrentTime()));
                    }, 300);
                  }}
                />
              </div>

              <div className={styles.videoMeta}>
                <img src={metadata.thumbnail} alt={metadata.title} loading="lazy" />
                <div>
                  <h2>{metadata.title}</h2>
                  <p>Duration: {formatTimestamp(metadata.duration)}</p>
                  <p>Current: {formatTimestamp(currentTime)}</p>
                </div>
              </div>
            </div>

            <div className={styles.controlsCard}>
              <h3>Clip Range</h3>

              <div className={styles.rangeRows}>
                <label>
                  Start
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, metadata.duration - 1)}
                    value={Math.min(startSeconds, metadata.duration - 1)}
                    onChange={(event) => {
                      const next = Math.min(Number(event.target.value), Math.max(0, endSeconds - 1));
                      setStartSeconds(next);
                      setStartInput(formatTimestamp(next));
                    }}
                  />
                </label>
                <label>
                  End
                  <input
                    type="range"
                    min={1}
                    max={metadata.duration}
                    value={Math.max(endSeconds, 1)}
                    onChange={(event) => {
                      const next = Math.max(Number(event.target.value), Math.min(metadata.duration, startSeconds + 1));
                      setEndSeconds(next);
                      setEndInput(formatTimestamp(next));
                    }}
                  />
                </label>
              </div>

              <div className={styles.timeGrid}>
                <label>
                  Start (mm:ss)
                  <input
                    value={startInput}
                    onChange={(event) => setStartInput(event.target.value)}
                    onBlur={(event) => handleStartInput(event.target.value)}
                  />
                </label>
                <label>
                  End (mm:ss)
                  <input
                    value={endInput}
                    onChange={(event) => setEndInput(event.target.value)}
                    onBlur={(event) => handleEndInput(event.target.value)}
                  />
                </label>
              </div>

              <div className={styles.quickActions}>
                <button onClick={() => setTimeFromPlayer("start")} disabled={status === "clipping"}>
                  Set Start from Current
                </button>
                <button onClick={() => setTimeFromPlayer("end")} disabled={status === "clipping"}>
                  Set End from Current
                </button>
              </div>

              <p className={styles.summary}>
                Selected clip: <strong>{formatTimestamp(startSeconds)}</strong> → <strong>{formatTimestamp(endSeconds)}</strong> ({formatTimestamp(clipLength)})
              </p>
              <label className={styles.selectLabel}>
                Resolution
                <select
                  className={styles.selectInput}
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value as ClipResolution)}
                  disabled={status === "clipping"}
                >
                  {CLIP_RESOLUTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option === "source" ? "Source (original)" : option}
                    </option>
                  ))}
                </select>
              </label>
              <p className={styles.helper}>Max clip length: {formatTimestamp(MAX_CLIP_SECONDS)}</p>

              <button
                className={styles.buttonPrimary}
                onClick={handleDownload}
                disabled={status === "clipping" || clipLength <= 0 || clipLength > MAX_CLIP_SECONDS}
              >
                {status === "clipping" ? "Creating MP4..." : "Download Clip"}
              </button>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
