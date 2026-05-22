# AI Sign Language Robot

Browser-based ASL learning and live translation using MediaPipe hand tracking and Google Gemini (ARIA tutor).

## Requirements

- Node.js 18.18 or newer (20 LTS recommended)
- A [Google AI Studio](https://aistudio.google.com/apikey) API key for the chat tutor

## Local development

```bash
npm install
cp .env.example .env.local
# Edit .env.local and set GOOGLE_GENERATIVE_AI_API_KEY
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Allow camera access when prompted.

## Deploy on Vercel

1. Push this repository to GitHub (do not commit `.env` or `.env.local`).
2. In [Vercel](https://vercel.com), import the GitHub repository.
3. Framework preset: **Next.js** (auto-detected).
4. Add an environment variable:
   - **Name:** `GOOGLE_GENERATIVE_AI_API_KEY`
   - **Value:** your Gemini API key
5. Deploy.

Build command: `npm run build`  
Output: Next.js default (no custom output directory).

### Vercel notes

- The app must be served over **HTTPS** for camera access (Vercel provides this).
- AI chat uses the `/api/chat` serverless route; the API key is only read on the server.
- If chat requests time out on the Hobby plan, upgrade the plan or reduce prompt length (Hobby limit is 10s per function).

## Scripts

| Command        | Description              |
|----------------|--------------------------|
| `npm run dev`  | Start development server |
| `npm run build`| Production build         |
| `npm run start`| Run production build     |
| `npm run lint` | Run ESLint               |

## Project structure

```
src/
  app/
    api/chat/route.ts   # Gemini API (server-only)
    layout.tsx
    page.tsx
    globals.css
  components/
    SignLanguageRobot.tsx
  lib/
    signClassifier.ts
```
