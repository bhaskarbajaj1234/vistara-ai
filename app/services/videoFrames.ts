import { VIDEO_FRAME_INTERVAL_MS, VIDEO_JPEG_QUALITY, VIDEO_MAX_WIDTH } from "../config/live";

export interface FrameOptions {
  intervalMs?: number;
  maxWidth?: number;
  quality?: number;
}

/**
 * Grab a downscaled JPEG frame from the <video> element at a fixed interval.
 * Returns a function that stops the capture.
 */
export function startFrameCapture(video: HTMLVideoElement, onFrame: (base64Jpeg: string) => void, options: FrameOptions = {}): () => void {
  const { intervalMs = VIDEO_FRAME_INTERVAL_MS, maxWidth = VIDEO_MAX_WIDTH, quality = VIDEO_JPEG_QUALITY } = options;
  const canvas = document.createElement("canvas");

  const timer = setInterval(() => {
    if (video.readyState < 2 || !video.videoWidth) return;

    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) return;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (b64) onFrame(b64);
  }, intervalMs);

  return () => clearInterval(timer);
}
