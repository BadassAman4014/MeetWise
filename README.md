# Meetwise

Browser-based meeting recorder with local Whisper transcription, speaker segmentation, and Gemini 3.6 Flash-powered meeting notes.

## Features

- Record from any microphone the browser can access, including a Bluetooth headset/microphone connected to your operating system.
- Import an existing audio or video file.
- Keep the original transcription, speaker segments, and meeting notes in browser local storage.
- Generate notes and refine transcripts through a server-only Gemini 2.5 Flash integration. Audio never goes to Gemini; only completed transcript text is sent when you request it.

## Local setup

```powershell
npm install
npm run download-models
Copy-Item .env.example .env
# Add your Gemini API key to .env
npm run dev
```

For a production-like run:

```powershell
npm run build
npm start
```

Do not use `vite preview` for this project: it is a static server and cannot serve the protected Gemini endpoint. `npm run preview` is configured to start the application server instead.

The local ONNX model files must be in `public/models/`. They are excluded from Git because of their size.

## Gemini key safety

`GEMINI_API_KEY` is read only by the Node server and is never bundled into the React app. Do not prefix it with `VITE_` and do not commit `.env`.

Bluetooth microphones must first be paired with the operating system; the browser then exposes them in the microphone selector (after granting microphone permission at least once).
