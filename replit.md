# Bot Builder

A personal-use full-stack app for generating ProRealTime trading bots using AI, with an additional Text tab for translating/transforming literary texts.

## Overview
This project is a full-stack application designed for personal use, offering two primary functionalities:
1.  **Bot Builder**: An AI-powered tool for generating ProRealTime/ProBuilder trading bot code. It includes interactive charting, extensive bot settings, and AI-driven code generation and error correction.
2.  **Text Transformer**: An AI-powered literary translation and content generation tool. It supports translating texts from any language to English, metadata detection, PDF generation, and custom translation instructions.

The application aims to streamline the creation of sophisticated trading algorithms and facilitate high-quality literary translation and content generation, leveraging AI capabilities without requiring external API keys.

## User Preferences
-   Private/personal use only (never deploy)
-   No external API keys - uses Replit-managed AI models
-   Auto-save translations without extra clicks
-   Save Prompt checkbox enabled by default to save custom prompts

## System Architecture
The application features a modern full-stack architecture:
-   **Frontend**: Built with Vite, using Vanilla JavaScript and Tailwind CSS for a responsive and modern UI. It integrates Lightweight Charts for interactive data visualization in the Bot Builder tab.
-   **Backend**: Powered by Node.js and Express, providing API endpoints for AI interactions, data persistence, and file operations.
-   **AI Integration**: Leverages Replit AI Integrations (Claude Sonnet as primary, GPT-4o-mini as fallback) for all AI-driven functionalities, eliminating the need for user-supplied API keys.
-   **Data Storage**: Utilizes JSON file-based storage for translation history, saved prompts, and bot configurations, located in the `data/` directory. Generated PDFs are stored in the `downloads/` directory.
-   **UI/UX**:
    -   **Tabbed Interface**: `Text` and `Bot Builder` tabs for distinct functionalities.
    -   **Dynamic Sidebars**: Left sidebar for history (translation or bot), and a right sidebar for saved prompts, both collapsible and mobile-responsive.
    -   **Dark Mode**: Supports a toggle for dark and light themes.
    -   **Interactive Charts**: The Bot Builder tab includes an interactive candlestick chart with drawing tools, asset, and timeframe selectors.
    -   **PDF Generation**: Offers professional PDF generation with various output options for translated texts.
    -   **Bot Simulation**: Includes a comprehensive simulator for backtesting generated bots with equity curve, trade analysis, and detailed performance metrics.
    -   **Optimization**: Features a variable optimization engine for bot parameters, including auto-optimization with multiple metrics.
    -   **ProRealTime Documentation System**: A built-in system for managing ProRealTime documentation, allowing AI to reference relevant syntax and rules.

## External Dependencies
-   **Vite**: Frontend build tool.
-   **Tailwind CSS**: Utility-first CSS framework for styling.
-   **Lightweight Charts**: For interactive candlestick charts in the Bot Builder.
-   **Node.js**: Backend runtime environment.
-   **Express**: Web framework for the backend API.
-   **Replit AI Integrations**: For AI model access (Claude Sonnet, GPT-4o-mini).
-   **Yahoo Finance API**: For live candlestick data across 50+ assets (no API key required).
-   **MetalPriceAPI**: Fallback for real-time Silver & Gold spot prices (requires `METALS_API_KEY` secret).

## Recent Changes (Jan 28, 2026)
- **Backtest Simulation Panel** (New Feature):
  - New panel in AI Results for running historical backtest simulations
  - **Cycles selector**: Run 1, 5, 10, 25, 50, or 100 simulation rounds
  - **Timeframe selector**: 5m, 15m, 1h, 4h, 1d, 1w, 1M
  - **Trade hold duration**: Hold trades for 1, 3, 5, or 10 candles
  - **Progress bar**: Shows cycle progress during simulation
  - **Results display**: Total trades, win rate, P/L, avg trade, best cycle
  - Asset-specific contract specs for accurate P/L calculation
  - Automatically caps cycles based on available data

- **New Timeframes Added**:
  - Weekly (1w) and Monthly (1M) timeframes added to chart and projection
  - Backtest simulation supports all timeframes

- **AI Memory System** (New Feature):
  - New "AI Memory" sub-tab in AI Trading section
  - **Brain Status Panel**: Shows accuracy %, total predictions, patterns learned, confidence level per asset
  - **Cross-Asset Correlations**: Gold/Silver ratio, Gold vs S&P 500 with live ratio tracking
  - **News & Events Archive**: Wiki-style storage for market events with asset price reactions
  - Memory data stored in `data/ai-memory/` (brain.json, events.json, correlations.json)
  - AI analysis now references past performance and historical events in strategy generation
  - Backend API endpoints: `/api/ai-memory/brain`, `/api/ai-memory/events`, `/api/ai-memory/correlations`

- **Check Online News Feature**:
  - "Check Online" button fetches market events using AI (based on training knowledge)
  - Review modal allows selecting which events to add to archive
  - "Check Daily" checkbox with localStorage persistence for auto-checking on app load (once per day)

- **Observe Mode Feature** (Fixed & Enhanced):
  - "Observe" toggle button for real-time market observation
  - Polls price data every 30 seconds when enabled
  - **Fixed prediction tracking**: Now properly records predictions and verifies them 5 minutes later against actual price movement
  - **Advanced pattern detection**: Uses SMA/EMA alignment, RSI, MACD, momentum, and wave position analysis
  - Weighted confidence scoring from multiple indicators
  - Pending predictions queue shows count during observation
  - Patterns now track actual success rate (not self-fulfilling like before)
  - Live status indicator shows "Observing: [time] (X pending)"

- **Brain Training Tutorial**:
  - Brain trains automatically when you: 1) Run AI analysis on any asset, 2) Enable Observe mode
  - Each prediction/observation records: direction, confidence, patterns detected
  - Accuracy builds over time as more predictions are recorded
  - View stats in AI Memory tab: accuracy %, predictions count, patterns learned

- **AI Chat Panel** (New Feature):
  - Real-time chat interface with Claude in AI Results section
  - Discuss trading strategies, market analysis, and ideas
  - AI has context: current asset, timeframe, brain memory, learned patterns
  - Chat history preserved in localStorage
  - Supports Enter to send, Clear button to reset
  - Backend endpoint: `/api/ai/chat`

- **AI Price Projection Chart** (Complete Rewrite - True AI Predictions):
  - **No more formulas**: Projection now uses actual AI (Claude/GPT) to predict prices
  - AI receives: recent price data, brain memory patterns, historical accuracy, market events
  - AI analyzes patterns and makes intelligent predictions based on learned data
  - Returns 3 scenarios: Expected (most likely), Bullish, Bearish
  - **AI reasoning displayed**: Shows why AI made its prediction
  - Falls back to trend extrapolation only if AI fails
  - **Timeframe label & data info**: Shows current timeframe badge and candle date range
  - Increased to 500 projection points for better forecast visualization

- **AI Trading Panel** (New Feature):
  - New "AI Trading" panel in AI Results tab above Prediction Accuracy
  - **Mock Trading Engine**: Runs paper trades using Capital & Fees settings
  - **Silver Contract Specs**: Min size 0.05, 100/point, 1 point = $1 AUD
  - **Multi-Timeframe Analysis**: Fetches ALL timeframes (1m, 5m, 15m, 1h, 4h, 1d) before each decision
  - **News Sentiment Check**: Uses AI to analyze market news/breaking events before trades
  - **Learning System**: Adjusts strategy weights (trend, RSI, MACD, wave, news) based on win/loss outcomes
  - **Market Speed Awareness**: Adjusts trade interval based on volatility (fast markets = faster decisions)
  - **Blinking Buy/Sell Signals**: Green/red animated indicators for trade execution
  - **Trade List**: Shows recent trades with entry/exit prices, P&L, timestamps
  - **Stats Display**: Capital, P&L, Win Rate, Trade Count, Current Position, Learning Score
  - State persisted to localStorage

- **Backtest Simulation Feature**:
  - New "Backtest" dropdown in AI Projection panel with time offsets:
    - Live (now), -1 min, -10 min, -30 min, -1 hour, -4 hours, -12 hours, -1 day, -1 week
  - Backtest accuracy summary panel shows:
    - Direction comparison (AI prediction vs actual movement)
    - Predicted price, Actual price, Error percentage
    - Color-coded accuracy badge (green/yellow/red)
  - Chart visualization shows:
    - Gray line: Historical data before backtest point
    - Green line: What actually happened after backtest point
    - Blue dashed line: What AI would have predicted
  - Re-runs AI analysis on historical data (not just reusing current prediction)
  - Uses correct timeframe API endpoints based on selected timeframe

## Previous Changes (Jan 27, 2026)
- **Yahoo Finance Data Integration**:
  - Replaced TwelveData API with Yahoo Finance (no API key required)
  - Added 50+ popular assets across all categories:
    - Precious Metals: Silver, Gold, Platinum, Palladium (futures & spot)
    - Energy: Crude Oil WTI, Brent, Natural Gas, Gasoline RBOB
    - Agricultural: Corn, Wheat, Soybeans, Coffee, Sugar, Cotton, Cocoa
    - Forex Majors: EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD, NZD/USD
    - Forex Crosses: EUR/GBP, EUR/JPY, GBP/JPY
    - US Indices: S&P 500, NASDAQ, Dow Jones, Russell 2000, VIX
    - European Indices: DAX 40, FTSE 100, CAC 40, Euro Stoxx 50
    - Asian Indices: Nikkei 225, Hang Seng, Shanghai Composite
    - US Stocks: AAPL, MSFT, GOOGL, AMZN, NVDA, TSLA, META
    - Crypto: BTC/USD, ETH/USD, SOL/USD, XRP/USD
    - ETFs: SPY, QQQ, IWM, GLD, SLV, USO, TLT
  - Implemented caching with appropriate TTL per timeframe
  - Added 4-hour timeframe aggregation from 1-hour data

- **AI Trading Tab**:
  - New third sub-tab in Bot Builder: Settings | Simulator | AI Trading
  - Purple color scheme to distinguish from main bot builder (indigo)
  - Two internal sub-tabs: "AI Strategy" and "AI Results"
  - **AI Strategy Section**:
    - Symbol/Session selectors (XAGUSD, XAUUSD, auto-detect session)
    - Search bar with filter chips (Trend, Mean Rev, Breakout, London, NY, Asia, timeframes)
    - Market Context card: auto-detected symbol, session, volatility, regime, structure, confidence
    - Strategy Hypotheses cards with tags, rationale bullets, "Add to Bot" and "Use" buttons
    - Learning Feedback panel: similar setups count, performance trend, adaptation suggestions
  - **AI Results Section**:
    - Timeframe selector buttons (M5, M15, H1, H4)
    - Directional Bias table per timeframe with confidence indicators
    - Price Targets table with probability bars (Primary, Stretch, Risk)
    - Probability Curve SVG visualization with skew/confidence info
    - ProRealTime Output collapsible panel with sample code and copy/add buttons
  - All components are static UI placeholders ready for backend integration

## Previous Changes (Jan 20, 2026)
- **AI Research Q&A Mode**:
  - Renamed "Paste Base Code" to "Custom / Paste Code" in strategy dropdown
  - Widened textarea to match preview code box (300% width)
  - Changed label to "Paste Base Code / Custom Description"
  - AI detects if input is code vs description (uses keyword detection)
  - For descriptions: AI asks 2-4 clarifying questions before generating
  - Purple Q&A panel appears with questions, answer textarea, Submit/Skip buttons
  - Original description + Q&A context included in generation prompt
- **ProRealTime Documentation System**:
  - New "Docs" button next to strategy Ideas button
  - Categorized markdown docs stored in data/prt-docs/
  - Docs automatically injected into AI prompts based on keywords
  - Full CRUD UI modal for viewing/editing/creating/deleting docs
- **Datapoints Selector for Simulation**:
  - New dropdown in Simulator tab: 1k, 2k, 5k, 10k, 100k datapoints
- **Second-based Timeframes**:
  - Added 1s, 2s, 3s, 5s, 10s, 30s options to chart timeframe selector
- **Indicator Checkbox Fix**:
  - Fixed useOBV, useHeikinAshi, useTrailingStop using ?? instead of ||