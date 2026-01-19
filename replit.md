# Bot Builder

A personal-use full-stack app for generating ProRealTime trading bots using AI, with an additional Text tab for translating/transforming literary texts.

## Overview
- **Purpose**: Two main features:
  1. **Bot Builder Tab** (default): Generate ProRealTime/ProBuilder trading bot code with interactive charts and AI
  2. **Text Tab**: Translate texts (books, documents) from any language to English using AI, with support for custom translation instructions
- **Tech Stack**: Vite (Vanilla JS + Tailwind CSS) frontend with Lightweight Charts, Node.js + Express backend
- **AI Models**: Uses Replit AI Integrations (Claude Sonnet as primary, GPT-4o-mini as fallback) - no API keys needed
- **Storage**: JSON file-based storage for translation history and saved prompts, local file storage for generated PDFs

## Project Structure
```
/
├── client/                 # Vite frontend
│   ├── index.html         # Main HTML with tabs (Text + Bot Builder)
│   ├── src/
│   │   ├── main.js        # Main frontend JavaScript (tab switching, text features)
│   │   ├── botBuilder.js  # Bot Builder tab logic (chart, settings, AI generation)
│   │   └── style.css      # Tailwind imports + custom styles
│   ├── vite.config.js     # Vite config (port 5000, proxy to backend)
│   ├── tailwind.config.js # Tailwind config with dark mode support
│   └── package.json       # Frontend dependencies (includes lightweight-charts)
├── server/
│   └── index.js           # Express server (port 3001)
├── fonts/                  # Roboto TTF fonts for PDF generation
├── data/                   # Persistent storage
│   ├── translations.json  # Translation history
│   └── prompts.json       # Saved prompts library
├── downloads/              # Generated PDFs storage
├── package.json           # Backend dependencies
├── README.md              # Full documentation
└── start.js               # Combined launcher script
```

## Features

### Text Tab (Translation/Generation)
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

### Bot Builder Tab (ProRealTime Bot Generator)
1. **Interactive Chart**: Candlestick chart powered by Lightweight Charts
   - Asset selector: Silver, Gold, Copper, Oil, Gas, Forex pairs, Indices
   - Timeframe selector: 1m to Daily
   - Drawing tools: Trend lines, horizontal/vertical lines, high/low markers
2. **Bot Settings Panel**:
   - Position size, trade type (long/short/both), cumulate orders
   - Stop loss and take profit in points
   - Trailing stop with configurable % and step
   - Indicator toggles (OBV, Heikin Ashi) with periods
   - Strategy type selection (13th Warrior, Sniper, Breakout, Custom)
3. **Time & Session Filters**:
   - Timezone selector (Brisbane AEST UTC+10 default, plus major trading zones)
   - Exclude weekends and major holidays
   - Custom trading hours (start/end time)
   - Session avoidance: exclude first/last X minutes of session
   - Force close positions before session end
   - Day of week selectors (Mon-Sun)
4. **AI Code Generation**:
   - Compiles chart annotations + settings into bot description
   - Sends to AI with ProRealTime syntax rules
   - Outputs ready-to-use ProBuilder code
5. **Error Correction**:
   - Paste ProRealTime error messages
   - AI fixes code and regenerates

### Common Features
8. **Dark Mode**: Toggle between light and dark themes
9. **Mobile Responsive**: Collapsible sidebars with hamburger menus
10. **Tab Navigation**: Switch between Text and Bot Builder tabs

## UI Layout
- **Left Sidebar**: Translation History with nested story display
- **Main Content**: Input form, progress, output with PDF download
- **Right Sidebar**: Saved Prompts library

## API Endpoints

### Text Tab
- `POST /api/parse-pdf` - Extract text from uploaded PDF
- `POST /api/detect-metadata` - AI detection of title/author from text
- `POST /api/translate` - Translate text (SSE streaming)
- `POST /api/generate-pdf` - Generate PDF from translation
- `GET /api/history` - List all translations (includes story titles for nesting)
- `GET /api/history/:id` - Get specific translation with full content
- `DELETE /api/history/:id` - Delete translation

### Bot Builder Tab
- `POST /api/generate-bot` - Generate ProRealTime bot code (accepts optional screenshotBase64)
- `POST /api/fix-bot` - Fix bot code based on error message
- `GET /api/bot-history` - List all saved bot generations
- `GET /api/bot-history/:id` - Get specific bot entry with full code
- `DELETE /api/bot-history/:id` - Delete bot entry

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

## Recent Changes (Jan 19, 2026)
- **Real-time Market Data**: 
  - Silver & Gold: MetalPriceAPI (METALS_API_KEY secret) - real spot prices with generated candles
  - Forex pairs: Twelve Data API for live candlestick data
  - Falls back to sample data if APIs unavailable
- **Bot Builder Tab**: New tab for generating ProRealTime/ProBuilder trading bots
  - Interactive candlestick chart with Lightweight Charts v5
  - Drawing tools (trend lines, horizontal/vertical lines, high/low markers)
  - Asset selector with commodities, forex, and indices
  - Timeframe selector triggers data reload
  - **Fee Settings Panel**: Initial capital, max position size, order fee ($/order), spread (pips)
  - Bot settings panel with position, risk, indicator, and strategy options
  - AI-powered code generation with ProRealTime syntax rules (includes fee settings)
  - Error correction feature to fix code based on error messages
  - **Screenshot upload**: Upload or paste (Ctrl+V) chart screenshots for AI analysis
  - **Bot History sidebar**: Left sidebar shows saved bots when on Bot Builder tab
  - **Auto-save**: Each generated bot is saved to its own JSON file in data/bots/
  - **Simulator Tab**: Backtest generated bot on current chart data
    - Run backtest with fee/spread calculations
    - **Equity Curve Chart**: Cyan line showing cumulative profit over time
    - **Trade Analysis Chart**: Price chart with trade markers (green arrows for buy, red arrows for sell, yellow circles for exits with P&L)
    - Results dashboard: total gain, win rate (pie chart), gain/loss ratio
    - Trade distribution (winning/losing/neutral)
    - Max drawdown, max runup, time in market %, avg orders/day
    - Average gain per trade with best/worst trade stats
    - Daily performance bar chart

## Earlier Changes (Dec 12, 2025)
- **Cancel Generation Button**: Red cancel button appears during processing to abort generation
- **Model Selection Dropdown**: Choose between Claude (4.5, 4, Opus, 3.5 Sonnet/Haiku) and GPT (4o, 4o-mini, 4-turbo) models
- **File Rotation System**: Data files rotate after 10 entries (translations_timestamp.json, prompts_timestamp.json) to prevent data loss

## Earlier Changes (Dec 10, 2025)
- **Added Content Generation Mode**: Source text is now optional - leave empty and describe a topic to generate original content
- **Rebranded to "Literator"** with unique SVG logo (purple/indigo book with orange-red pen)
- Added comprehensive README.md documentation
- Added Custom Styles text field below Custom Instructions
- Added Save Prompt checkbox (checked by default)
- Added right sidebar for saved prompts with delete buttons
- Added nested history structure (book → stories)
- Added Suno song format template as default prompt
- Added scrollbars to both sidebars
- Fixed event delegation for prompts sidebar (Vite module scope compatibility)
- History items now restore ALL input fields (original text, title, author, instructions, styles, story mode)
- Enhanced translation prompts to better respect "keep original language" instructions
- **Moved saved prompts to server-side storage** (data/prompts.json) for cross-browser compatibility
