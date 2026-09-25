# Realtime Multimodal AI Web Application

An advanced web application built with Next.js and Google Gemini 3.8 Live, designed for low-latency, bidirectional audio, video, and text interaction. Features real-time live transcription and multi-modal input processing.

---

## Key Features

- **Realtime Multimodal Interaction:** Stream audio, image, and video feeds directly to the Gemini 3.8 Live Multimodal Live API.
- **Live Transcription:** Instant transcript generation powered by Gemini's generative models.
- **Modern Stack:** Built on Next.js for high performance, fast server-side rendering, and seamless deployment.
- **Responsive UI:** Clean and intuitive user interface optimized for real-time media feeds.

---

## System Architecture

+------------------+         WebSocket / Stream        +------------------------+
|                  | --------------------------------> |                        |
|  Next.js Frontend |                                   | Gemini 3.8 Live API    |
| (Audio/Video/UI) | <-------------------------------- |                        |
+------------------+           Live Transcripts        +------------------------+

---

## Prerequisites

Before setting up the project, ensure you have the following installed:

- **Node.js:** v18.0.0 or higher
- **Package Manager:** `npm`, `yarn`, or `pnpm`
- **Google Gemini API Key:** Obtainable via Google AI Studio

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/realtime-multimodal-gemini-app.git

2. Install Dependencies
npm install
# or
yarn install
# or
pnpm install

3. Environment Configuration
Create a local environment file by copying the example template:

cp .env.example .env.local

Open .env.local and insert your Gemini API Key:

GEMINI_API_KEY=your_gemini_api_key_here

4. Run the Development Server

npm run dev
# or
yarn dev
# or
pnpm dev

Open http://localhost:3000 in your browser to view and interact with the application.

Available Scripts
npm run dev — Runs the app in development mode.

npm run build — Builds the app for production deployment.

npm run start — Starts the production server.

npm run lint — Runs ESLint to check for code quality issues.

Tech Stack
Framework: Next.js

AI Models: Google Gemini 3.8 Multimodal Live API

Styling: Tailwind CSS / CSS Modules

Language: JavaScript / TypeScript
cd realtime-multimodal-gemini-app
2. Install Dependencies
