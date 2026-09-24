import { TranscriptionService } from './transcriptionService';
import { pcmToWav } from '../utils/audioUtils';

const MODEL = "models/gemini-3.8-live";
const API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const HOST = "generativelanguage.googleapis.com";

const WS_URL =
  `wss://${HOST}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`;

export class GeminiWebSocket {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private isSetupComplete = false;

  private onMessageCallback: ((text: string) => void) | null = null;
  private onSetupCompleteCallback: (() => void) | null = null;
  private onPlayingStateChange: ((isPlaying: boolean) => void) | null = null;
  private onAudioLevelChange: ((level: number) => void) | null = null;
  private onTranscriptionCallback: ((text: string) => void) | null = null;

  private audioContext: AudioContext | null = null;

  // Audio playback queue
  private audioQueue: Float32Array[] = [];
  private isPlaying = false;
  private currentSource: AudioBufferSourceNode | null = null;
  private isPlayingResponse = false;

  // Used by the existing transcription service
  private transcriptionService: TranscriptionService;
  private accumulatedPcmData: string[] = [];

  constructor(
    onMessage: (text: string) => void,
    onSetupComplete: () => void,
    onPlayingStateChange: (isPlaying: boolean) => void,
    onAudioLevelChange: (level: number) => void,
    onTranscription: (text: string) => void
  ) {
    this.onMessageCallback = onMessage;
    this.onSetupCompleteCallback = onSetupComplete;
    this.onPlayingStateChange = onPlayingStateChange;
    this.onAudioLevelChange = onAudioLevelChange;
    this.onTranscriptionCallback = onTranscription;

    this.audioContext = new AudioContext({
      sampleRate: 24000,
    });

    this.transcriptionService = new TranscriptionService();
  }

  connect() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    console.log("[WebSocket] Connecting to Gemini...");

    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      console.log("[WebSocket] Connected");

      this.isConnected = true;

      this.sendInitialSetup();
    };

    this.ws.onmessage = async (event) => {
      try {
        let messageText: string;

        if (event.data instanceof Blob) {
          const arrayBuffer = await event.data.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);

          messageText = new TextDecoder("utf-8").decode(bytes);
        } else {
          messageText = event.data;
        }

        console.log("[WebSocket] Message received:", messageText);

        await this.handleMessage(messageText);
      } catch (error) {
        console.error(
          "[WebSocket] Error processing message:",
          error
        );
      }
    };

    this.ws.onerror = (error) => {
      console.error("[WebSocket] Error:", error);
    };

    this.ws.onclose = (event) => {
      this.isConnected = false;
      this.isSetupComplete = false;

      console.warn(
        `[WebSocket] Closed: code=${event.code}, reason=${event.reason}, wasClean=${event.wasClean}`
      );
    };
  }

  private sendInitialSetup() {
    const setupMessage = {
      setup: {
        model: MODEL,

        generationConfig: {
          responseModalities: ["AUDIO"],
        },

        inputAudioTranscription: {},

        outputAudioTranscription: {},
      },
    };

    console.log(
      "[WebSocket] Sending setup:",
      setupMessage
    );

    this.ws?.send(JSON.stringify(setupMessage));
  }

  /**
   * Send realtime audio or video to Gemini.
   */
  sendMediaChunk(
    b64Data: string,
    mimeType: string
  ) {
    if (
      !this.isConnected ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN ||
      !this.isSetupComplete
    ) {
      return;
    }

    let message;

    // Audio input
    if (mimeType === "audio/pcm") {
      message = {
        realtimeInput: {
          audio: {
            mimeType: "audio/pcm;rate=16000",
            data: b64Data,
          },
        },
      };
    }

    // Camera frame
    else if (mimeType === "image/jpeg") {
      message = {
        realtimeInput: {
          video: {
            mimeType: "image/jpeg",
            data: b64Data,
          },
        },
      };
    }

    else {
      console.warn(
        "[WebSocket] Unsupported MIME type:",
        mimeType
      );
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error(
        "[WebSocket] Error sending realtime input:",
        error
      );
    }
  }

  /**
   * Play Gemini's generated PCM audio.
   */
  private async playAudioResponse(
    base64Data: string
  ) {
    if (!this.audioContext) {
      return;
    }

    try {
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      const binaryString = atob(base64Data);

      const bytes = new Uint8Array(
        binaryString.length
      );

      for (
        let i = 0;
        i < binaryString.length;
        i++
      ) {
        bytes[i] =
          binaryString.charCodeAt(i);
      }

      const pcmData = new Int16Array(
        bytes.buffer
      );

      const float32Data =
        new Float32Array(
          pcmData.length
        );

      for (
        let i = 0;
        i < pcmData.length;
        i++
      ) {
        float32Data[i] =
          pcmData[i] / 32768.0;
      }

      this.audioQueue.push(
        float32Data
      );

      this.playNextInQueue();
    } catch (error) {
      console.error(
        "[WebSocket] Error processing audio:",
        error
      );
    }
  }

  private playNextInQueue() {
    if (
      !this.audioContext ||
      this.isPlaying ||
      this.audioQueue.length === 0
    ) {
      return;
    }

    try {
      this.isPlaying = true;
      this.isPlayingResponse = true;

      this.onPlayingStateChange?.(true);

      const float32Data =
        this.audioQueue.shift()!;

      // Calculate output audio level
      let sum = 0;

      for (
        let i = 0;
        i < float32Data.length;
        i++
      ) {
        sum += Math.abs(
          float32Data[i]
        );
      }

      const level = Math.min(
        (sum / float32Data.length) *
        100 *
        5,
        100
      );

      this.onAudioLevelChange?.(
        level
      );

      // Gemini output audio = 24kHz PCM
      const audioBuffer =
        this.audioContext.createBuffer(
          1,
          float32Data.length,
          24000
        );

      audioBuffer
        .getChannelData(0)
        .set(float32Data);

      this.currentSource =
        this.audioContext.createBufferSource();

      this.currentSource.buffer =
        audioBuffer;

      this.currentSource.connect(
        this.audioContext.destination
      );

      this.currentSource.onended =
        () => {
          this.isPlaying = false;
          this.currentSource = null;

          if (
            this.audioQueue.length === 0
          ) {
            this.isPlayingResponse =
              false;

            this.onPlayingStateChange?.(
              false
            );
          }

          this.playNextInQueue();
        };

      this.currentSource.start();
    } catch (error) {
      console.error(
        "[WebSocket] Error playing audio:",
        error
      );

      this.isPlaying = false;
      this.isPlayingResponse = false;

      this.currentSource = null;

      this.onPlayingStateChange?.(
        false
      );

      this.playNextInQueue();
    }
  }

  private stopCurrentAudio() {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        // Already stopped
      }

      this.currentSource = null;
    }

    this.isPlaying = false;
    this.isPlayingResponse = false;

    this.onPlayingStateChange?.(
      false
    );

    this.audioQueue = [];
  }

  private async handleMessage(
    message: string
  ) {
    try {
      const messageData =
        JSON.parse(message);

      // --------------------------------
      // SETUP COMPLETE
      // --------------------------------

      if (
        messageData.setupComplete
      ) {
        console.log(
          "[WebSocket] Gemini setup complete"
        );

        this.isSetupComplete = true;

        this.onSetupCompleteCallback?.();

        return;
      }

      // --------------------------------
      // SERVER CONTENT
      // --------------------------------

      const serverContent =
        messageData.serverContent;

      if (!serverContent) {
        return;
      }

      // --------------------------------
      // USER INPUT TRANSCRIPTION
      // --------------------------------

      if (
        serverContent.inputTranscription?.text
      ) {
        const text =
          serverContent
            .inputTranscription
            .text;

        console.log(
          "[Gemini Input]:",
          text
        );

        this.onMessageCallback?.(
          text
        );
      }

      // --------------------------------
      // MODEL OUTPUT TRANSCRIPTION
      // --------------------------------

      if (
        serverContent.outputTranscription?.text
      ) {
        const text =
          serverContent
            .outputTranscription
            .text;

        console.log(
          "[Gemini Output]:",
          text
        );

        this.onMessageCallback?.(
          text
        );
      }

      // --------------------------------
      // MODEL AUDIO
      // --------------------------------

      if (
        serverContent.modelTurn?.parts
      ) {
        const parts =
          serverContent
            .modelTurn
            .parts;

        for (const part of parts) {
          if (
            part.inlineData?.mimeType ===
            "audio/pcm;rate=24000"
          ) {
            const audioData =
              part.inlineData.data;

            this.accumulatedPcmData.push(
              audioData
            );

            await this.playAudioResponse(
              audioData
            );
          }
        }
      }

      // --------------------------------
      // MODEL INTERRUPTED
      // --------------------------------

      if (
        serverContent.interrupted === true
      ) {
        console.log(
          "[WebSocket] Model interrupted"
        );

        this.stopCurrentAudio();
      }

      // --------------------------------
      // TURN COMPLETE
      // --------------------------------

      if (
        serverContent.turnComplete === true
      ) {
        console.log(
          "[WebSocket] Turn complete"
        );

        if (
          this.accumulatedPcmData.length >
          0
        ) {
          try {
            const fullPcmData =
              this.accumulatedPcmData.join(
                ""
              );

            const wavData =
              await pcmToWav(
                fullPcmData,
                24000
              );

            const transcription =
              await this.transcriptionService.transcribeAudio(
                wavData,
                "audio/wav"
              );

            console.log(
              "[Transcription]:",
              transcription
            );

            this.onTranscriptionCallback?.(
              transcription
            );

            this.accumulatedPcmData =
              [];
          } catch (error) {
            console.error(
              "[WebSocket] Transcription error:",
              error
            );

            this.accumulatedPcmData =
              [];
          }
        }
      }
    } catch (error) {
      console.error(
        "[WebSocket] Error parsing message:",
        error
      );
    }
  }

  disconnect() {
    console.log(
      "[WebSocket] Disconnecting..."
    );

    this.isSetupComplete = false;

    this.stopCurrentAudio();

    if (this.ws) {
      this.ws.close(
        1000,
        "Intentional disconnect"
      );

      this.ws = null;
    }

    this.isConnected = false;

    this.accumulatedPcmData = [];
  }
}