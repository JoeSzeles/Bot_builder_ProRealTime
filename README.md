# Bot Builder for ProRealTime

An AI-powered full-stack application for generating ProRealTime/ProBuilder trading bot code with interactive charts, backtesting simulation, and variable optimization.

![Bot Builder Main Interface](docs/images/Screenshot_2026-01-19_at_16-01-04_Bot_Builder_1768806022121.png)

## Features

### Interactive Chart with Drawing Tools
- Candlestick charts powered by Lightweight Charts v5
- Multiple assets: Silver, Gold, Copper, Oil, Gas, Forex pairs, Indices
- Timeframes from 1 minute to Daily
- Drawing tools: trend lines, horizontal/vertical lines, high/low markers

### AI-Powered Strategy Ideas
Search for trading strategies from ProRealCode forum patterns. Get instant ideas for breakout, trend following, mean reversion, scalping, RSI, MACD, and Bollinger strategies.

![Strategy Ideas Search](docs/images/ufyeuife_1768806022120.JPG)

### Bot Settings & Code Generation
- Position size, trade type (long/short/both), cumulate orders
- Stop loss and take profit configuration
- Trailing stop with configurable % and step
- Indicator toggles (OBV, Heikin Ashi) with periods
- Time and session filters with timezone support
- AI generates ready-to-use ProBuilder code

### Backtest Simulator
Test your generated bots against historical data with detailed performance metrics:

![Backtest Simulator](docs/images/Screenshot_2026-01-19_at_14-41-04_Bot_Builder_1768806022122.png)

- Equity curve visualization
- Trade analysis with buy/sell/exit markers
- Win rate, gain/loss ratio, max drawdown
- Daily performance breakdown
- Fee and spread calculations

### Variable Optimization
Fine-tune your bot parameters with interactive sliders and auto-optimization:

![Variable Optimization](docs/images/dgtrt4y_1768806022121.JPG)

- Auto-detect numeric variables from generated code
- Interactive sliders with bidirectional sync
- Run multiple optimization iterations (5-300)
- Multiple metrics: Total Gain, Win Rate, Gain/Loss Ratio, Sharpe-like

### Optimization Results
Compare and apply the best configurations:

![Optimization Results](docs/images/urutrutr_1768806022121.JPG)

- Top 10 results comparison chart
- Detailed result cards with all variables
- One-click apply to use any configuration
- Copy code with optimized values

### Result Details Modal
View comprehensive details for each optimization result:

![Result Details](docs/images/Screenshot_2026-01-19_at_16-04-14_Bot_Builder_1768806022120.png)

- All variable values applied
- Full performance statistics
- Copy code button with variables applied
- Apply configuration instantly

## Tech Stack

- **Frontend**: Vite + Vanilla JS + Tailwind CSS
- **Charts**: Lightweight Charts v5
- **Backend**: Node.js + Express
- **AI Models**: Claude Sonnet & GPT-4o via Replit AI Integrations
- **Storage**: JSON file-based persistence

## Project Structure

```
/
├── client/                 # Vite frontend
│   ├── index.html         # Main HTML with tabs
│   ├── src/
│   │   ├── main.js        # Main frontend JavaScript
│   │   ├── botBuilder.js  # Bot Builder logic
│   │   └── style.css      # Tailwind + custom styles
│   ├── vite.config.js     # Vite configuration
│   └── package.json       # Frontend dependencies
├── server/
│   └── index.js           # Express server
├── data/                   # Persistent storage
│   ├── bots/              # Saved bot configurations
│   ├── strategies.json    # Strategy templates
│   └── search-history.json # Search history
├── docs/images/           # Screenshots
└── package.json           # Backend dependencies
```

## Running the App

### Development

1. Start the backend server:
```bash
node server/index.js
```

2. Start the frontend (in another terminal):
```bash
cd client && npm run dev
```

The frontend runs on port 5000 and proxies API requests to the backend on port 3001.

## Key Features Detail

### Strategy Template Library
- Save discovered strategies to dropdown menu
- Auto-load saved strategies on page load
- One-click fill of Custom Instructions

### Search History
- Auto-saves all strategy searches
- Browse past searches with date/time
- Expand to see all results from any search
- Add/Use buttons work from history entries

### ProRealCode Forum Conventions
- Code follows forum conventions: flat structure, verbose IF/ENDIF
- Assumes IG Markets + ProRealTime AutoTrading (ProOrder) environment
- Only documented ProBuilder functions used

### Variable Persistence
- Slider adjustments auto-save to bot history
- Restore configurations when reopening saved bots

## API Endpoints

### Bot Builder
- `POST /api/generate-bot` - Generate ProRealTime bot code
- `POST /api/fix-bot` - Fix bot code based on error message
- `GET /api/bot-history` - List all saved bot generations
- `POST /api/simulate-bot` - Run backtest simulation
- `GET /api/strategies` - Get saved strategy templates
- `POST /api/strategies` - Save a strategy template
- `GET /api/search-history` - Get search history
- `POST /api/search-strategies` - Search for strategy ideas

## Additional Feature: Text Translation

The app also includes a **Text tab** for translating/transforming literary texts:
- AI-powered translation with custom instructions
- Multiple AI model support (Claude & GPT)
- PDF generation with professional book layout
- Translation history and saved prompts

---

## Buy Me a Coffee (or Bread... Literally Just Bread)

Hey there, fellow human! If this bot builder has saved you countless hours of staring at ProBuilder documentation until your eyes crossed, or helped you generate that one strategy that *almost* didn't blow up your demo account... consider tossing a few crypto coins my way!

I'm just a humble coder surviving on a strict diet of bread and water (the sparkling kind on good days). Your donation could upgrade my dinner from "plain bread" to "bread with butter" or even the legendary "bread with cheese" combo!

**Every satoshi helps keep the AI running and the developer dreaming about one day affording avocado toast.**

### Ethereum (ETH)
*For when you want to gas me up (pun intended)*

<p align="center">
  <img src="docs/images/ethereum_qr.jpg" alt="Ethereum QR Code" width="200"/>
</p>

```
0xf5D65740108977498E14776F1D5E2c6CefFa2666
```

### Bitcoin (BTC)
*For the OG hodlers who remember when this could buy a pizza*

<p align="center">
  <img src="docs/images/bitcoin_qr.jpg" alt="Bitcoin QR Code" width="200"/>
</p>

```
bc1qsny8dhsnmv0hzs7ctsmfxy2cn7vqk79gs0acv0
```

**Thank you for being awesome!** Whether you donate or just star this repo, you're helping a broke coder believe that maybe, just maybe, all those late nights debugging were worth it.

*Note: Side effects of donating may include: warm fuzzy feelings, instant karma, and knowing you helped someone level up from instant noodles to... slightly better instant noodles.*

---

## License

Personal use only. Not for commercial distribution.
