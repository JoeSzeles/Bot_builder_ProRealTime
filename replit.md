# Bot Builder

## Overview
This project is a full-stack application designed for personal use, offering two primary functionalities: Bot Builder and Text Transformer. The **Bot Builder** is an AI-powered tool for generating ProRealTime/ProBuilder trading bot code, featuring interactive charting, extensive bot settings, and AI-driven code generation and error correction. The **Text Transformer** is an AI-powered literary translation and content generation tool, supporting multilingual translation to English, metadata detection, PDF generation, and custom translation instructions. The application aims to streamline the creation of sophisticated trading algorithms and facilitate high-quality literary translation and content generation by leveraging Replit's AI capabilities without requiring external API keys.

## User Preferences
- Private/personal use only (never deploy)
- No external API keys - uses Replit-managed AI models
- Auto-save translations without extra clicks
- Save Prompt checkbox enabled by default to save custom prompts

## System Architecture
The application features a modern full-stack architecture with a focus on AI integration, user experience, and data persistence:

**Frontend:**
- Built with Vite, Vanilla JavaScript, and Tailwind CSS.
- Lightweight Charts v5 for high-performance financial charting.
- Tabbed interface: "Text" and "Bot Builder" (includes Forecast, Settings, Simulator, AI Trading).
- Dynamic, collapsible sidebars for history and saved prompts.
- Interactive candlestick charts with drawing tools and asset selectors.

**Backend:**
- Node.js and Express API.
- Replit AI Integrations (Claude Sonnet 3.5 / GPT-4o-mini).
- FFmpeg for server-side video synthesis and audio mixing.
- File-based JSON storage in `data/` and `downloads/`.

**AI Integration:**
- Leverages Replit AI Integrations (Claude Sonnet primary, GPT-4o-mini fallback) for all AI-driven functionalities.
- AI-powered price projection, generating bullish, bearish, and expected scenarios with reasoning.
- AI chat interface with context-aware responses regarding trading strategies and market analysis.
- AI Memory System to track prediction accuracy, learned patterns, and cross-asset correlations, influencing strategy generation.
- ProRealTime Documentation System allows AI to reference relevant syntax and rules.
- AI Research Q&A Mode for clarifying user descriptions before code generation.

**Data Storage:**
- Uses JSON file-based storage in the `data/` directory for translation history, saved prompts, and bot configurations.
- Generated PDFs are stored in the `downloads/` directory.
- AI memory data (brain, events, correlations) is stored in `data/ai-memory/`.

**Core Features & Functionality:**
- **Bot Simulation**: Comprehensive simulator for backtesting generated bots, including equity curves, trade analysis, and performance metrics.
- **Optimization Engine**: Variable optimization engine for bot parameters, with auto-optimization features.
- **Pattern Performance Map**: Visual heatmap in AI Memory for analyzing pattern performance.
- **Parameter Optimization System**: Allows definition of optimizable parameter ranges for trading strategies, with options for random, learned, and auto-optimized parameters.
- **Portfolio Protection**: Implements position sizing capped by capital allocation and max risk per trade.
- **Backtest Trading Settings**: Configurable trade types, initial capital, position sizing, order fees, and spread costs.
- **Backtest Simulation**: Runs multiple simulation rounds with various timeframes and trade hold durations.
- **Observe Mode**: Real-time market observation mode that polls price data, tracks predictions, and detects advanced patterns.
- **AI Trading Panel**: Mock trading engine with multi-timeframe analysis, news sentiment checks, a learning system, and real-time trade signals and statistics.
- **Market Radio**: AI-powered audio newscast with market forecasts, text-to-speech, and social sharing.
    - Presenters: Caelix-9 (Warhammer 40K Tech-Priest), Sophie Mitchell (cheerful), Jack Thompson (Australian), Patrick Bateman (American Psycho), John McAfee (Crypto Anarchist).
    - Daily and 7-day forecasts based on real Yahoo Finance 1h candle data.
    - Daily Podcast mode: Multi-host discussions with voice swapping and segment-based video switching.
    - Video Podcast Generation: Creates MP4 videos with speaker-specific video feeds and newsroom-style overlays using FFmpeg.
    - Media Customization Panel: Upload and select custom avatar images, speaker-specific videos, background videos, and background music.
    - Editable Script Editor: Customize the broadcast script before audio generation.
    - Video Player Popup: Interactive player with audio controls and video display.
    - Broadcast History Panel: Manage history with play/download/regenerate/share/delete options.
    - Social sharing via Discord/Twitter Player Cards with rich metadata.

**Known Limitations (Future Improvements):**
- Market context analysis uses 24h rolling windows instead of true trading session boundaries

## External Dependencies
- **Vite**: Frontend build tool.
- **Tailwind CSS**: Utility-first CSS framework.
- **Lightweight Charts**: For interactive candlestick charts.
- **Node.js**: Backend runtime environment.
- **Express**: Web framework for the backend API.
- **Replit AI Integrations**: For AI model access (Claude Sonnet, GPT-4o-mini).
- **Yahoo Finance API**: For live candlestick data across 50+ assets.
- **MetalPriceAPI**: Fallback for real-time Silver & Gold spot prices (requires `METALS_API_KEY` secret).
