/** Tunable constants for the realtime pipeline. Each one is a latency / bandwidth trade-off. */

/** Microphone audio is sent as 16-bit PCM at 16 kHz (what the Live API expects). */
export const LIVE_INPUT_SAMPLE_RATE = 16_000;

/** Model audio comes back as 16-bit PCM at 24 kHz. */
export const LIVE_OUTPUT_SAMPLE_RATE = 24_000;

/**
 * Samples per mic frame sent over the socket. 1024 samples at 16 kHz = 64 ms.
 * Smaller frames lower capture latency but increase the number of WebSocket messages per second.
 */
export const MIC_FRAME_SAMPLES = 1024;

/** One JPEG frame per second keeps bandwidth low; the Live API samples video at ~1 fps anyway. */
export const VIDEO_FRAME_INTERVAL_MS = 1000;
export const VIDEO_MAX_WIDTH = 640;
export const VIDEO_JPEG_QUALITY = 0.7;

/** Mic level (0-100) above which we consider the user to be speaking, for the voice-latency metric. */
export const SPEECH_LEVEL_THRESHOLD = 6;

/** Reconnect policy for unexpected socket closes. */
export const MAX_RECONNECT_ATTEMPTS = 5;
export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 16_000;

/** How often the stats panel refreshes (one React update per interval, not per event). */
export const STATS_INTERVAL_MS = 1_000;
