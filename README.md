# Literator

A full-stack AI-powered application for translating, transforming, and generating literary content with professional PDF output.

## Features

### Two Modes of Operation

**1. Translation/Transformation Mode**
- Paste or upload source text
- AI translates or transforms it according to your instructions

**2. Content Generation Mode**
- Leave the source text empty
- Describe a topic in the "Topic or Instructions" field
- AI researches and writes original content in your requested style

### Text Input (Optional)
- **Drag & Drop**: Upload .txt, .pdf, or .md files directly
- **Paste Text**: Copy and paste text into the input area
- **Leave Empty**: Skip to generate content from a topic instead
- **Auto-detect Metadata**: AI automatically detects book title and author from the text

### AI Model Selection
Choose your preferred AI model from the dropdown:
- **Anthropic Claude**: Sonnet 4.5 (Best), Sonnet 4, Opus 4, 3.5 Sonnet, 3.5 Haiku (Fast)
- **OpenAI GPT**: GPT-4o, GPT-4o Mini (Fast), GPT-4 Turbo

### Translation & Transformation
- **AI-Powered Translation**: Uses your selected model with automatic fallback
- **Custom Instructions**: Add specific translation guidelines (e.g., "preserve poetic rhythm", "keep honorifics in original language")
- **Custom Styles**: Specify output style (e.g., "Victorian prose", "minimalist poetry")
- **Language Preservation**: Supports keeping original language when specified in instructions
- **Cancel Button**: Stop generation at any time with the cancel button

### Story Collection Mode
- **Anthology Support**: Enable for books with multiple stories/chapters
- **Automatic Story Detection**: AI identifies individual stories within a collection
- **Nested History View**: Collections display with expandable story lists
- **Individual Story Access**: Click any story to view just that content

### PDF Generation
- **Single PDF**: Download complete translation as one professional PDF
- **Chapter ZIP**: Split translation into separate PDFs by chapter
- **Story ZIP**: For collections, get individual PDFs for each story
- **Professional Layout**: Book-style formatting with proper typography

### Saved Prompts Library
- **Save Custom Prompts**: Store frequently used instruction/style combinations
- **Pre-populated Templates**: Includes Suno Song Format template
- **One-Click Apply**: Click any saved prompt to fill instruction fields
- **Server-Side Storage**: Prompts persist across browsers and sessions

### Translation History
- **Automatic Saving**: All translations are saved automatically
- **Full Restoration**: Click any history item to restore all input fields
- **Nested Display**: Collections show expandable story lists
- **Delete Option**: Remove unwanted history entries

### User Interface
- **Dark Mode**: Toggle between light and dark themes
- **Mobile Responsive**: Collapsible sidebars with hamburger menus
- **Two-Sidebar Layout**: History on left, Saved Prompts on right

## Running the Application

### Prerequisites
- Node.js (v18 or higher recommended)
- npm

### Installation

1. Install backend dependencies:
```bash
npm install
```

2. Install frontend dependencies:
```bash
cd client && npm install
```

### Starting the Application

Run both servers simultaneously:

**Backend Server** (port 3001):
```bash
node server/index.js
```

**Frontend** (port 5000):
```bash
cd client && npm run dev
```

The application will be available at `http://localhost:5000`

## Project Structure

```
/
├── client/                 # Vite frontend
│   ├── index.html         # Main HTML with UI layout
│   ├── src/
│   │   ├── main.js        # Frontend JavaScript logic
│   │   └── style.css      # Tailwind + custom styles
│   ├── vite.config.js     # Vite configuration
│   ├── tailwind.config.js # Tailwind configuration
│   └── package.json       # Frontend dependencies
├── server/
│   └── index.js           # Express backend server
├── fonts/                  # Roboto fonts for PDF generation
├── data/                   # Persistent storage
│   ├── translations.json  # Translation history
│   └── prompts.json       # Saved prompts library
├── downloads/              # Generated PDF storage
├── package.json           # Backend dependencies
└── README.md              # This file
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/parse-pdf` | POST | Extract text from uploaded PDF |
| `/api/detect-metadata` | POST | AI detection of title/author from text |
| `/api/translate` | POST | Translate text (SSE streaming) |
| `/api/generate-pdf` | POST | Generate PDF from translation |
| `/api/history` | GET | List all translations |
| `/api/history/:id` | GET | Get specific translation |
| `/api/history/:id` | DELETE | Delete translation |
| `/api/prompts` | GET | List all saved prompts |
| `/api/prompts` | POST | Save new prompt |
| `/api/prompts/:index` | DELETE | Delete saved prompt |

## Usage Tips

1. **For best translation results**: Provide clear custom instructions about tone, style, and any terms to preserve
2. **Story collections**: Enable "Story Collection" checkbox for anthologies to get per-story PDFs
3. **Language preservation**: Include phrases like "keep original language" or "do not translate" in instructions
4. **Saved prompts**: Check "Save Prompt" (enabled by default) to save your instruction/style combination for reuse

## Tech Stack

- **Frontend**: Vite, Vanilla JavaScript, Tailwind CSS
- **Backend**: Node.js, Express
- **AI Models**: Claude Sonnet (via Replit AI), GPT-4o-mini (fallback)
- **PDF Generation**: pdfmake with Roboto fonts
- **Storage**: JSON file-based persistence
