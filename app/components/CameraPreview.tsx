"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "../../components/ui/button";
import { Video, VideoOff } from "lucide-react";
import { GeminiWebSocket } from "../services/geminiWebSocket";
import { Base64 } from "js-base64";

interface CameraPreviewProps {
  onTranscription: (text: string) => void;
}

export default function CameraPreview({
  onTranscription,
}: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const [isStreaming, setIsStreaming] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const geminiWsRef = useRef<GeminiWebSocket | null>(null);
  const videoCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);

  const [isAudioSetup, setIsAudioSetup] = useState(false);
  const setupInProgressRef = useRef(false);

  const [isWebSocketReady, setIsWebSocketReady] = useState(false);

  const imageIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [outputAudioLevel, setOutputAudioLevel] = useState(0);

  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");

  // ---------------------------------------------------------
  // Cleanup Audio
  // ---------------------------------------------------------
  const cleanupAudio = useCallback(() => {
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setIsAudioSetup(false);
  }, []);

  // ---------------------------------------------------------
  // Cleanup WebSocket
  // ---------------------------------------------------------
  const cleanupWebSocket = useCallback(() => {
    if (geminiWsRef.current) {
      geminiWsRef.current.disconnect();
      geminiWsRef.current = null;
    }

    setIsWebSocketReady(false);
  }, []);

  // ---------------------------------------------------------
  // Send Audio Data to Gemini
  // ---------------------------------------------------------
  const sendAudioData = useCallback((b64Data: string) => {
    if (!geminiWsRef.current) return;

    geminiWsRef.current.sendMediaChunk(b64Data, "audio/pcm");
  }, []);

  // ---------------------------------------------------------
  // Toggle Camera
  // ---------------------------------------------------------
  const toggleCamera = async () => {
    // Stop streaming
    if (isStreaming && stream) {
      setIsStreaming(false);

      cleanupWebSocket();
      cleanupAudio();

      stream.getTracks().forEach((track) => track.stop());

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      setStream(null);
      setConnectionStatus("disconnected");

      return;
    }

    // Start streaming
    try {
      // Video
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      // Audio
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true,
        },
      });

      // Audio context
      audioContextRef.current = new AudioContext({
        sampleRate: 16000,
      });

      // Attach video
      if (videoRef.current) {
        videoRef.current.srcObject = videoStream;
        videoRef.current.muted = true;
      }

      // Combine audio + video tracks
      const combinedStream = new MediaStream([
        ...videoStream.getTracks(),
        ...audioStream.getTracks(),
      ]);

      setStream(combinedStream);
      setIsStreaming(true);
    } catch (err) {
      console.error("Error accessing media devices:", err);

      cleanupAudio();

      setIsStreaming(false);
      setConnectionStatus("disconnected");
    }
  };

  // ---------------------------------------------------------
  // Initialize Gemini WebSocket
  // ---------------------------------------------------------
  useEffect(() => {
    if (!isStreaming) {
      setConnectionStatus("disconnected");
      setIsWebSocketReady(false);
      return;
    }

    setConnectionStatus("connecting");

    geminiWsRef.current = new GeminiWebSocket(
      // -----------------------------------------------------
      // Gemini text response
      // -----------------------------------------------------
      (text) => {
        console.log("Received from Gemini:", text);

        // IMPORTANT:
        // Forward Gemini response to parent UI
        onTranscription(text);
      },

      // -----------------------------------------------------
      // WebSocket setup complete
      // -----------------------------------------------------
      () => {
        console.log(
          "[Camera] WebSocket setup complete, starting media capture"
        );

        setIsWebSocketReady(true);
        setConnectionStatus("connected");
      },

      // -----------------------------------------------------
      // Model speaking state
      // -----------------------------------------------------
      (isPlaying) => {
        setIsModelSpeaking(isPlaying);
      },

      // -----------------------------------------------------
      // Model audio level
      // -----------------------------------------------------
      (level) => {
        setOutputAudioLevel(level);
      },

      // -----------------------------------------------------
      // Transcription callback
      // -----------------------------------------------------
      onTranscription
    );

    geminiWsRef.current.connect();

    return () => {
      if (imageIntervalRef.current) {
        clearInterval(imageIntervalRef.current);
        imageIntervalRef.current = null;
      }

      cleanupWebSocket();

      setIsWebSocketReady(false);
      setConnectionStatus("disconnected");
    };
  }, [
    isStreaming,
    onTranscription,
    cleanupWebSocket,
  ]);

  // ---------------------------------------------------------
  // Start Image Capture
  // ---------------------------------------------------------
  useEffect(() => {
    if (!isStreaming || !isWebSocketReady) {
      return;
    }

    console.log("[Camera] Starting image capture interval");

    imageIntervalRef.current = setInterval(
      captureAndSendImage,
      1000
    );

    return () => {
      if (imageIntervalRef.current) {
        clearInterval(imageIntervalRef.current);
        imageIntervalRef.current = null;
      }
    };
  }, [isStreaming, isWebSocketReady]);

  // ---------------------------------------------------------
  // Audio Processing
  // ---------------------------------------------------------
  useEffect(() => {
    if (
      !isStreaming ||
      !stream ||
      !audioContextRef.current ||
      !isWebSocketReady ||
      isAudioSetup ||
      setupInProgressRef.current
    ) {
      return;
    }

    let isActive = true;

    setupInProgressRef.current = true;

    const setupAudioProcessing = async () => {
      try {
        const ctx = audioContextRef.current;

        if (
          !ctx ||
          ctx.state === "closed" ||
          !isActive
        ) {
          setupInProgressRef.current = false;
          return;
        }

        // Resume audio context if suspended
        if (ctx.state === "suspended") {
          await ctx.resume();
        }

        // Load audio worklet
        await ctx.audioWorklet.addModule(
          "/worklets/audio-processor.js"
        );

        if (!isActive) {
          setupInProgressRef.current = false;
          return;
        }

        // Create AudioWorklet
        audioWorkletNodeRef.current = new AudioWorkletNode(
          ctx,
          "audio-processor",
          {
            numberOfInputs: 1,
            numberOfOutputs: 1,

            processorOptions: {
              sampleRate: 16000,
              bufferSize: 4096,
            },

            channelCount: 1,
            channelCountMode: "explicit",
            channelInterpretation: "speakers",
          }
        );

        // Create media source
        const source = ctx.createMediaStreamSource(stream);

        // Receive processed PCM data
        audioWorkletNodeRef.current.port.onmessage = (
          event
        ) => {
          if (!isActive || isModelSpeaking) {
            return;
          }

          const { pcmData, level } = event.data;

          // Update microphone audio level
          setAudioLevel(level);

          // Convert PCM data to Uint8Array
          const pcmArray = new Uint8Array(pcmData);

          // Convert to Base64
          const b64Data =
            Base64.fromUint8Array(pcmArray);

          // Send audio to Gemini
          sendAudioData(b64Data);
        };

        // Connect source to worklet
        source.connect(audioWorkletNodeRef.current);

        setIsAudioSetup(true);
        setupInProgressRef.current = false;

        return () => {
          source.disconnect();

          if (audioWorkletNodeRef.current) {
            audioWorkletNodeRef.current.disconnect();
          }

          setIsAudioSetup(false);
        };
      } catch (error) {
        console.error(
          "[Camera] Audio processing setup failed:",
          error
        );

        if (isActive) {
          cleanupAudio();
          setIsAudioSetup(false);
        }

        setupInProgressRef.current = false;
      }
    };

    console.log(
      "[Camera] Starting audio processing setup"
    );

    setupAudioProcessing();

    return () => {
      isActive = false;

      setIsAudioSetup(false);
      setupInProgressRef.current = false;

      if (audioWorkletNodeRef.current) {
        audioWorkletNodeRef.current.disconnect();
        audioWorkletNodeRef.current = null;
      }
    };
  }, [
    isStreaming,
    stream,
    isWebSocketReady,
    isModelSpeaking,
    sendAudioData,
    cleanupAudio,
  ]);

  // ---------------------------------------------------------
  // Capture and Send Image
  // ---------------------------------------------------------
  const captureAndSendImage = () => {
    if (
      !videoRef.current ||
      !videoCanvasRef.current ||
      !geminiWsRef.current
    ) {
      return;
    }

    const canvas = videoCanvasRef.current;

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    // Match canvas size with video
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;

    // Draw current video frame
    context.drawImage(
      videoRef.current,
      0,
      0
    );

    // Convert image to JPEG Base64
    const imageData = canvas.toDataURL(
      "image/jpeg",
      0.8
    );

    const b64Data = imageData.split(",")[1];

    if (!b64Data) {
      return;
    }

    // Send image to Gemini
    geminiWsRef.current.sendMediaChunk(
      b64Data,
      "image/jpeg"
    );
  };

  // ---------------------------------------------------------
  // UI
  // ---------------------------------------------------------
  return (
    <div className="space-y-4">
      <div className="relative">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-[640px] h-[480px] bg-muted rounded-lg overflow-hidden"
        />

        {/* Connection Status Overlay */}
        {isStreaming &&
          connectionStatus !== "connected" && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg backdrop-blur-sm">
              <div className="text-center space-y-2">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto" />

                <p className="text-white font-medium">
                  {connectionStatus === "connecting"
                    ? "Connecting to Gemini..."
                    : "Disconnected"}
                </p>

                <p className="text-white/70 text-sm">
                  Please wait while we establish a secure
                  connection
                </p>
              </div>
            </div>
          )}

        {/* Camera Button */}
        <Button
          onClick={toggleCamera}
          size="icon"
          className={`absolute left-1/2 bottom-4 -translate-x-1/2 rounded-full w-12 h-12 backdrop-blur-sm transition-colors ${isStreaming
            ? "bg-red-500/50 hover:bg-red-500/70 text-white"
            : "bg-green-500/50 hover:bg-green-500/70 text-white"
            }`}
        >
          {isStreaming ? (
            <VideoOff className="h-6 w-6" />
          ) : (
            <Video className="h-6 w-6" />
          )}
        </Button>
      </div>

      {/* Audio Level */}
      {isStreaming && (
        <div className="w-[640px] h-2 rounded-full bg-green-100">
          <div
            className="h-full rounded-full transition-all bg-green-500"
            style={{
              width: `${isModelSpeaking
                ? outputAudioLevel
                : audioLevel
                }%`,
              transition:
                "width 100ms ease-out",
            }}
          />
        </div>
      )}

      {/* Hidden Canvas */}
      <canvas
        ref={videoCanvasRef}
        className="hidden"
      />
    </div>
  );
}