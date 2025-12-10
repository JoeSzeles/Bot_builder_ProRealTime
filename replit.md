# Literary Translator App

A personal-use full-stack translator app for translating literary texts using AI and generating professional PDFs.

## Overview
- **Purpose**: Translate texts (books, documents) from any language to English using AI, with support for custom translation instructions
- **Tech Stack**: Vite (Vanilla JS + Tailwind CSS) frontend, Node.js + Express backend
- **AI Models**: Uses Replit AI Integrations (Claude Sonnet as primary, GPT-4o-mini as fallback) - no API keys needed
- **Storage**: JSON file-based storage for translation history, local file storage for generated PDFs, localStorage for saved prompts

## Project Structure
```
/
├── client/                 # Vite frontend
│   ├── index.html         # Main HTML with Tailwind-styled UI (two sidebars layout)
│   ├── src/
│   │   ├── main.js        # Frontend JavaScript logic
│   │   └── style.css      # Tailwind imports + custom styles
│   ├── vite.config.js     # Vite config (port 5000, proxy to backend)
│   ├── tailwind.config.js # Tailwind config with dark mode support
│   └── package.json       # Frontend dependencies
├── server/
│   └── index.js           # Express server (port 3001)
├── fonts/                  # Roboto TTF fonts for PDF generation
├── data/                   # Translation history storage
│   └── translations.json  # JSON database for history
├── downloads/              # Generated PDFs storage
├── package.json           # Backend dependencies
└── start.js               # Combined launcher script
```

## Features
1. **Text Input**: Paste text or drag-and-drop .txt/.pdf/.md files
2. **Auto-detect Metadata**: AI-powered detection of book title and author from input text
3. **Translation**: AI-powered literary translation with custom instructions and styles
4. **Story Collection Mode**: Checkbox for anthology/collection books - AI detects individual stories
5. **PDF Generation**: Single PDF, chapter-split ZIP, or story-split ZIP with professional book layout
6. **History Sidebar (Left)**: 
   - Automatic saving, loading, and deletion of past translations
   - Nested structure: collection title with expandable sub-stories
   - Click story to view just that story's content
7. **Prompts Sidebar (Right)**:
   - Save custom prompts (instructions + styles) for reuse
   - Pre-populated with Suno song format template
   - Click to fill both Custom Instructions and Custom Styles fields
   - Delete button on hover
8. **Dark Mode**: Toggle between light and dark themes
9. **Mobile Responsive**: Collapsible sidebars with hamburger menus

## UI Layout
- **Left Sidebar**: Translation History with nested story display
- **Main Content**: Input form, progress, output with PDF download
- **Right Sidebar**: Saved Prompts library

## API Endpoints
- `POST /api/parse-pdf` - Extract text from uploaded PDF
- `POST /api/detect-metadata` - AI detection of title/author from text
- `POST /api/translate` - Translate text (SSE streaming)
- `POST /api/generate-pdf` - Generate PDF from translation
- `GET /api/history` - List all translations (includes story titles for nesting)
- `GET /api/history/:id` - Get specific translation with full content
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
- Save Prompt checkbox enabled by default to save custom prompts

## Recent Changes (Dec 10, 2025)
- Added Custom Styles text field below Custom Instructions
- Added Save Prompt checkbox (checked by default)
- Added right sidebar for saved prompts with delete buttons
- Added nested history structure (book → stories)
- Added Suno song format template as default prompt
- Added scrollbars to both sidebars
- Fixed event delegation for prompts sidebar (Vite module scope compatibility)
- History items now restore ALL input fields (original text, title, author, instructions, styles, story mode)
- Enhanced translation prompts to better respect "keep original language" instructions:
  - Detects keywords like "do not translate", "keep original language", "same language"
  - Modifies system prompt to explicitly prevent translation when detected
  - Custom styles are now properly passed to the AI models
- **Moved saved prompts to server-side storage** (like translation history):
  - Prompts stored in `data/prompts.json`
  - New API endpoints: GET/POST /api/prompts, DELETE /api/prompts/:index
  - Automatic migration of existing localStorage prompts to server
  - Works consistently across all browsers (Firefox compatibility fixed)
