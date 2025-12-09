# Literary Translator App

A personal-use full-stack translator app for translating literary texts using AI and generating professional PDFs.

## Overview
- **Purpose**: Translate texts (books, documents) from any language to English using AI, with support for custom translation instructions
- **Tech Stack**: Vite (Vanilla JS + Tailwind CSS) frontend, Node.js + Express backend
- **AI Models**: Uses Replit AI Integrations (Claude Sonnet as primary, GPT-4o-mini as fallback) - no API keys needed
- **Storage**: JSON file-based storage for translation history, local file storage for generated PDFs

## Project Structure
```
/
├── client/                 # Vite frontend
│   ├── index.html         # Main HTML with Tailwind-styled UI
│   ├── src/
│   │   ├── main.js        # Frontend JavaScript logic
│   │   └── style.css      # Tailwind imports + custom styles
│   ├── vite.config.js     # Vite config (port 5000, proxy to backend)
│   ├── tailwind.config.js # Tailwind config with dark mode support
│   └── package.json       # Frontend dependencies
├── server/
│   └── index.js           # Express server (port 3001)
├── data/                   # Translation history storage
│   └── translations.json  # JSON database for history
├── downloads/              # Generated PDFs storage
├── package.json           # Backend dependencies
└── start.js               # Combined launcher script
```

## Features
1. **Text Input**: Paste text or drag-and-drop .txt/.pdf/.md files
2. **Translation**: AI-powered literary translation with custom instructions
3. **PDF Generation**: Single PDF or chapter-split ZIP with professional book layout
4. **History**: Automatic saving, loading, and deletion of past translations
5. **Dark Mode**: Toggle between light and dark themes
6. **Mobile Responsive**: Collapsible sidebar with hamburger menu

## API Endpoints
- `POST /api/parse-pdf` - Extract text from uploaded PDF
- `POST /api/translate` - Translate text (SSE streaming)
- `POST /api/generate-pdf` - Generate PDF from translation
- `GET /api/history` - List all translations
- `GET /api/history/:id` - Get specific translation
- `DELETE /api/history/:id` - Delete translation

## Running the App
The app runs with two workflows:
1. **Backend Server**: `node server/index.js` (port 3001)
2. **Frontend**: `cd client && npm run dev` (port 5000)

The frontend proxies API requests to the backend.

## User Preferences
- Private/personal use only (never deploy)
- No external API keys - uses Replit-managed AI models
- Auto-save translations without extra clicks
