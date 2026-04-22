# Genie AI Presentation Builder

A professional AI-powered presentation builder that generates structured content and themes using Genie AI (Gemini).

## Features

- **AI Content Generation**: Enter a topic and let Genie AI generate slides, structure, and content.
- **PDF Export**: Download high-fidelity PDF presentations.
- **PPTX Export**: Download editable PowerPoint files.
- **Theme Support**: Professional light and dark modes.
- **Interactive UI**: Built with React, Tailwind CSS, and Framer Motion.

## Deployment on Vercel

This project is optimized for deployment on Vercel.

### Prerequisites

1. A Vercel account.
2. A Gemini API Key from [Google AI Studio](https://aistudio.google.com/app/apikey).

### Deployment Steps

1. **Push to GitHub**: Push this repository to your GitHub account.
2. **Import to Vercel**:
   - Go to [Vercel Dashboard](https://vercel.com/dashboard).
   - Click **Add New...** > **Project**.
   - Import your GitHub repository.
3. **Configure Environment Variables**:
   - During the import process, expand **Environment Variables**.
   - Add `GEMINI_API_KEY` with your key from Google AI Studio.
4. **Deploy**:
   - Click **Deploy**. Vercel will automatically detect Vite and build the project.

### Technical Details

- **Framework**: React 19 + Vite 6
- **Styling**: Tailwind CSS 4
- **AI**: @google/genai (Gemini 1.5 Flash/Preview)
- **PDF Generation**: jsPDF + html2canvas
- **PPTX Generation**: PptxGenJS
- **Routing**: `vercel.json` included for SPA support.
