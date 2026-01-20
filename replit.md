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
-   **MetalPriceAPI**: For real-time Silver & Gold spot prices (requires `METALS_API_KEY` secret).
-   **Twelve Data API**: For live Forex candlestick data.