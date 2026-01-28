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
- **AI Price Projection Chart Fix**:
  - Fixed value explosion bug where projections reached astronomical numbers (90 trillion)
  - Implemented bounded random walk algorithm (prices stay within 50%-200% of start)
  - Added container dimension checks to defer chart rendering until visible
  - Chart now properly renders in AI Results tab with 10k forecast candles

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