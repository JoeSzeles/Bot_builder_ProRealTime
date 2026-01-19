import { createChart, ColorType, LineStyle, CrosshairMode, CandlestickSeries, LineSeries } from 'lightweight-charts';

let chart = null;
let candleSeries = null;
let drawings = [];
let drawingMode = null;
let drawingPoints = [];
let generatedBotCode = '';
let initialized = false;
let priceLines = [];
let lineSeriesArr = [];
let markers = [];
let screenshotBase64 = null;

const FALLBACK_DATA = {
  silver: generateCandleData(32, 100, 0.02),
  gold: generateCandleData(2650, 100, 0.01),
  copper: generateCandleData(4.5, 100, 0.025),
  oil: generateCandleData(78, 100, 0.03),
  natgas: generateCandleData(3.2, 100, 0.04),
  eurusd: generateCandleData(1.03, 100, 0.005),
  gbpusd: generateCandleData(1.22, 100, 0.006),
  usdjpy: generateCandleData(156, 100, 0.004),
  spx500: generateCandleData(5900, 100, 0.012),
  dax: generateCandleData(20500, 100, 0.015),
  ftse: generateCandleData(8200, 100, 0.01)
};

let cachedData = {};

async function fetchMarketData(asset, timeframe = '1h') {
  const cacheKey = `${asset}_${timeframe}`;
  if (cachedData[cacheKey]) {
    return cachedData[cacheKey];
  }
  
  try {
    const response = await fetch(`/api/market-data/${asset}/${timeframe}`);
    const data = await response.json();
    
    if (data.error) {
      console.warn('API returned error:', data.error);
      return FALLBACK_DATA[asset] || FALLBACK_DATA.silver;
    }
    
    if (data.candles && data.candles.length > 0) {
      cachedData[cacheKey] = data.candles;
      return data.candles;
    }
  } catch (e) {
    console.warn('Failed to fetch live data, using fallback:', e);
  }
  
  return FALLBACK_DATA[asset] || FALLBACK_DATA.silver;
}

function generateCandleData(basePrice, numBars, volatility) {
  const data = [];
  let price = basePrice;
  const now = Math.floor(Date.now() / 1000);
  const hourInSeconds = 3600;
  
  for (let i = numBars; i >= 0; i--) {
    const time = now - (i * hourInSeconds);
    const change = (Math.random() - 0.5) * 2 * volatility * price;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * volatility * price * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * price * 0.5;
    
    data.push({
      time,
      open: parseFloat(open.toFixed(4)),
      high: parseFloat(high.toFixed(4)),
      low: parseFloat(low.toFixed(4)),
      close: parseFloat(close.toFixed(4))
    });
    
    price = close;
  }
  
  return data;
}

export async function initBotBuilder() {
  if (initialized && chart) {
    return;
  }
  
  const container = document.getElementById('chartContainer');
  if (!container) return;

  if (chart) {
    chart.remove();
    chart = null;
  }

  const isDark = document.documentElement.classList.contains('dark');
  
  chart = createChart(container, {
    width: container.clientWidth,
    height: 384,
    layout: {
      background: { type: ColorType.Solid, color: isDark ? '#1f2937' : '#111827' },
      textColor: isDark ? '#9ca3af' : '#d1d5db',
    },
    grid: {
      vertLines: { color: isDark ? '#374151' : '#374151' },
      horzLines: { color: isDark ? '#374151' : '#374151' },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
    },
    rightPriceScale: {
      borderColor: '#374151',
    },
    timeScale: {
      borderColor: '#374151',
      timeVisible: true,
    },
  });

  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderDownColor: '#ef4444',
    borderUpColor: '#22c55e',
    wickDownColor: '#ef4444',
    wickUpColor: '#22c55e',
  });

  const data = await fetchMarketData('eurusd', '1h');
  candleSeries.setData(data);
  chart.timeScale().fitContent();
  
  const assetSelect = document.getElementById('assetSelect');
  if (assetSelect) assetSelect.value = 'eurusd';

  const resizeHandler = () => {
    if (chart && container) {
      chart.applyOptions({ width: container.clientWidth });
    }
  };
  window.removeEventListener('resize', resizeHandler);
  window.addEventListener('resize', resizeHandler);

  setupBotBuilderEvents();
  setupSliderUpdates();
  initialized = true;
}

function setupSliderUpdates() {
  const trailingPercent = document.getElementById('trailingPercent');
  const trailingPercentVal = document.getElementById('trailingPercentVal');
  const stepPercent = document.getElementById('stepPercent');
  const stepPercentVal = document.getElementById('stepPercentVal');

  if (trailingPercent && trailingPercentVal) {
    trailingPercent.addEventListener('input', () => {
      trailingPercentVal.textContent = trailingPercent.value;
    });
  }

  if (stepPercent && stepPercentVal) {
    stepPercent.addEventListener('input', () => {
      stepPercentVal.textContent = stepPercent.value;
    });
  }
}

function setupBotBuilderEvents() {
  const assetSelect = document.getElementById('assetSelect');
  const drawLine = document.getElementById('drawLine');
  const drawHorizontal = document.getElementById('drawHorizontal');
  const drawVertical = document.getElementById('drawVertical');
  const markHigh = document.getElementById('markHigh');
  const markLow = document.getElementById('markLow');
  const clearDrawings = document.getElementById('clearDrawings');
  const generateBotBtn = document.getElementById('generateBotBtn');
  const copyBotCode = document.getElementById('copyBotCode');
  const saveBotCode = document.getElementById('saveBotCode');
  const fixBotError = document.getElementById('fixBotError');

  const timeframeSelect = document.getElementById('timeframeSelect');

  async function loadChartData() {
    const asset = assetSelect?.value || 'silver';
    const timeframe = timeframeSelect?.value || '1h';
    const data = await fetchMarketData(asset, timeframe);
    candleSeries.setData(data);
    chart.timeScale().fitContent();
    clearAllDrawings();
  }

  if (assetSelect) {
    assetSelect.addEventListener('change', loadChartData);
  }

  if (timeframeSelect) {
    timeframeSelect.addEventListener('change', loadChartData);
  }

  const drawTools = [
    { el: drawLine, mode: 'line' },
    { el: drawHorizontal, mode: 'horizontal' },
    { el: drawVertical, mode: 'vertical' },
    { el: markHigh, mode: 'high' },
    { el: markLow, mode: 'low' }
  ];

  drawTools.forEach(({ el, mode }) => {
    if (el) {
      el.addEventListener('click', () => {
        setDrawingMode(mode);
        document.querySelectorAll('.draw-tool').forEach(btn => btn.classList.remove('bg-blue-100', 'dark:bg-blue-900'));
        el.classList.add('bg-blue-100', 'dark:bg-blue-900');
      });
    }
  });

  if (clearDrawings) {
    clearDrawings.addEventListener('click', clearAllDrawings);
  }

  if (generateBotBtn) {
    generateBotBtn.addEventListener('click', generateBot);
  }

  if (copyBotCode) {
    copyBotCode.addEventListener('click', copyBotCodeToClipboard);
  }

  if (saveBotCode) {
    saveBotCode.addEventListener('click', saveBotCodeToFile);
  }

  if (fixBotError) {
    fixBotError.addEventListener('click', fixBotErrorAndRegenerate);
  }

  const chartContainer = document.getElementById('chartContainer');
  if (chartContainer) {
    chart.subscribeClick(handleChartClick);
  }
}

function setDrawingMode(mode) {
  drawingMode = mode;
  drawingPoints = [];
}

function handleChartClick(param) {
  if (!drawingMode || !param.time) return;

  const price = param.seriesData.get(candleSeries);
  if (!price) return;

  const point = {
    time: param.time,
    price: price.close,
    high: price.high,
    low: price.low
  };

  if (drawingMode === 'high') {
    addMarker(point, 'high');
    drawings.push({ type: 'high', point });
    updateDrawingCount();
  } else if (drawingMode === 'low') {
    addMarker(point, 'low');
    drawings.push({ type: 'low', point });
    updateDrawingCount();
  } else if (drawingMode === 'horizontal') {
    addHorizontalLine(point.price);
    drawings.push({ type: 'horizontal', price: point.price });
    updateDrawingCount();
  } else if (drawingMode === 'vertical') {
    addVerticalLine(point.time, point.price);
    drawings.push({ type: 'vertical', time: point.time, price: point.price });
    updateDrawingCount();
  } else if (drawingMode === 'line') {
    drawingPoints.push(point);
    if (drawingPoints.length === 2) {
      addTrendLine(drawingPoints[0], drawingPoints[1]);
      drawings.push({ type: 'line', start: drawingPoints[0], end: drawingPoints[1] });
      drawingPoints = [];
      updateDrawingCount();
    }
  }
}

function addMarker(point, type) {
  markers.push({
    time: point.time,
    position: type === 'high' ? 'aboveBar' : 'belowBar',
    color: type === 'high' ? '#22c55e' : '#ef4444',
    shape: type === 'high' ? 'arrowUp' : 'arrowDown',
    text: type === 'high' ? 'H' : 'L'
  });
  candleSeries.setMarkers(markers);
}

function addHorizontalLine(price) {
  const line = candleSeries.createPriceLine({
    price: price,
    color: '#3b82f6',
    lineWidth: 2,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: true,
    title: `Level ${price.toFixed(2)}`,
  });
  priceLines.push(line);
  return line;
}

function addTrendLine(start, end) {
  const line = chart.addSeries(LineSeries, {
    color: '#8b5cf6',
    lineWidth: 2,
    lineStyle: LineStyle.Solid,
  });
  line.setData([
    { time: start.time, value: start.price },
    { time: end.time, value: end.price }
  ]);
  lineSeriesArr.push(line);
}

function addVerticalLine(time, price) {
  const line = chart.addSeries(LineSeries, {
    color: '#f59e0b',
    lineWidth: 2,
    lineStyle: LineStyle.Dotted,
  });
  line.setData([
    { time: time, value: price * 0.95 },
    { time: time, value: price * 1.05 }
  ]);
  lineSeriesArr.push(line);
}

function clearAllDrawings() {
  drawings = [];
  drawingPoints = [];
  markers = [];
  candleSeries.setMarkers([]);
  
  priceLines.forEach(line => {
    try {
      candleSeries.removePriceLine(line);
    } catch (e) {}
  });
  priceLines = [];
  
  lineSeriesArr.forEach(line => {
    try {
      chart.removeSeries(line);
    } catch (e) {}
  });
  lineSeriesArr = [];
  
  updateDrawingCount();
}

function updateDrawingCount() {
  const countEl = document.getElementById('drawingCount');
  if (countEl) {
    countEl.textContent = `${drawings.length} drawing${drawings.length !== 1 ? 's' : ''}`;
  }
}

function getSettings() {
  return {
    asset: document.getElementById('assetSelect')?.value || 'silver',
    timeframe: document.getElementById('timeframeSelect')?.value || '1h',
    positionSize: parseFloat(document.getElementById('positionSize')?.value) || 0.5,
    tradeType: document.getElementById('tradeType')?.value || 'both',
    cumulateOrders: document.getElementById('cumulateOrders')?.checked || false,
    stopLoss: parseInt(document.getElementById('stopLoss')?.value) || 7000,
    takeProfit: parseInt(document.getElementById('takeProfit')?.value) || 300,
    useTrailingStop: document.getElementById('useTrailingStop')?.checked || true,
    trailingPercent: parseFloat(document.getElementById('trailingPercent')?.value) || 0.46,
    stepPercent: parseFloat(document.getElementById('stepPercent')?.value) || 0.018,
    useOBV: document.getElementById('useOBV')?.checked || true,
    obvPeriod: parseInt(document.getElementById('obvPeriod')?.value) || 5,
    useHeikinAshi: document.getElementById('useHeikinAshi')?.checked || true,
    strategyType: document.getElementById('strategyType')?.value || '13thwarrior',
    extraInstructions: document.getElementById('botExtraInstructions')?.value || '',
    drawings: drawings
  };
}

function buildBotDescription(settings) {
  let desc = `Generate a ProRealTime/ProBuilder trading bot with the following specifications:\n\n`;
  
  desc += `ASSET: ${settings.asset.toUpperCase()}\n`;
  desc += `TIMEFRAME: ${settings.timeframe}\n\n`;
  
  desc += `POSITION SETTINGS:\n`;
  desc += `- Position size: ${settings.positionSize}\n`;
  desc += `- Trade type: ${settings.tradeType === 'both' ? 'Long & Short' : settings.tradeType === 'long' ? 'Long Only' : 'Short Only'}\n`;
  desc += `- Cumulate orders: ${settings.cumulateOrders ? 'Yes' : 'No'}\n\n`;
  
  desc += `RISK MANAGEMENT:\n`;
  desc += `- Stop loss: ${settings.stopLoss} points\n`;
  desc += `- Take profit: ${settings.takeProfit} points\n`;
  
  if (settings.useTrailingStop) {
    desc += `- Trailing stop: Yes (${settings.trailingPercent}% trigger, ${settings.stepPercent}% step)\n`;
  }
  desc += `\n`;
  
  desc += `INDICATORS:\n`;
  if (settings.useOBV) {
    desc += `- OBV with period ${settings.obvPeriod}\n`;
  }
  if (settings.useHeikinAshi) {
    desc += `- Heikin Ashi candles\n`;
  }
  desc += `\n`;
  
  desc += `STRATEGY: ${settings.strategyType}\n`;
  
  if (settings.drawings.length > 0) {
    desc += `\nCHART ANNOTATIONS:\n`;
    settings.drawings.forEach((d, i) => {
      if (d.type === 'high') {
        desc += `- High point marked at price ${d.point.high.toFixed(4)}\n`;
      } else if (d.type === 'low') {
        desc += `- Low point marked at price ${d.point.low.toFixed(4)}\n`;
      } else if (d.type === 'horizontal') {
        desc += `- Horizontal level at ${d.price.toFixed(4)}\n`;
      } else if (d.type === 'line') {
        desc += `- Trend line from ${d.start.price.toFixed(4)} to ${d.end.price.toFixed(4)} (trading window)\n`;
      }
    });
  }
  
  if (settings.extraInstructions) {
    desc += `\nADDITIONAL INSTRUCTIONS:\n${settings.extraInstructions}\n`;
  }
  
  return desc;
}

const PROREALTIME_SYNTAX_RULES = `
CRITICAL PROREALTIME/PROBUILDER SYNTAX RULES:

1. VARIABLE NAMES:
   - NO underscores allowed in variable names (use CamelCase instead)
   - Correct: MyVariable, ObvBull, TrendUp
   - Wrong: My_Variable, OBV_Bull, Trend_Up

2. RESERVED WORDS:
   - Cannot use as variable names: Open, High, Low, Close, Volume, Average, Buy, Sell

3. IF BLOCKS:
   - Every IF must have matching ENDIF
   - Use ELSIF for else-if conditions
   - Structure:
     IF [Condition] THEN
         // code
     ENDIF

4. COMMANDS:
   - BUY x CONTRACT AT MARKET (open long)
   - SELLSHORT x CONTRACT AT MARKET (open short)
   - SELL AT MARKET (close long)
   - EXITSHORT AT MARKET (close short)
   - SET STOP PLOSS x (stop loss in points)
   - SET TARGET PROFIT x (take profit in points)

5. POSITION CHECKS:
   - ONMARKET (true if any position open)
   - LONGONMARKET (true if long position)
   - SHORTONMARKET (true if short position)
   - TRADEPRICE(1) (entry price of current trade)

6. INDICATORS:
   - Average[period](price)
   - ExponentialAverage[period](price)
   - RSI[period](price)
   - OBV(close)
   - AverageTrueRange[period]
   - Highest[period](high) / Lowest[period](low)

7. LOOKBACK:
   - Use brackets: CLOSE[1] = previous candle close
   - CLOSE[2] = 2 candles ago

8. INITIALIZATION:
   - Use ONCE for first-bar initialization: ONCE myVar = 100

9. PARAMETERS:
   - Defparam cumulateorders = true/false
`;

async function generateBot() {
  const settings = getSettings();
  const description = buildBotDescription(settings);
  
  const generateBotBtn = document.getElementById('generateBotBtn');
  const botOutputSection = document.getElementById('botOutputSection');
  const botCodeOutput = document.getElementById('botCodeOutput');
  const assetSelect = document.getElementById('assetSelect');
  const strategyType = document.getElementById('strategyType');
  
  generateBotBtn.disabled = true;
  generateBotBtn.innerHTML = '<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Generating...';

  try {
    const response = await fetch('/api/generate-bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        syntaxRules: PROREALTIME_SYNTAX_RULES,
        settings,
        screenshotBase64: screenshotBase64,
        asset: assetSelect?.value || 'unknown',
        strategy: strategyType?.value || 'custom'
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    generatedBotCode = data.code;
    botCodeOutput.textContent = generatedBotCode;
    botOutputSection.classList.remove('hidden');
    
    loadBotHistory();

  } catch (err) {
    alert('Error generating bot: ' + err.message);
  } finally {
    generateBotBtn.disabled = false;
    generateBotBtn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg> Generate ProRealTime Bot Code';
  }
}

async function copyBotCodeToClipboard() {
  if (!generatedBotCode) return;
  
  await navigator.clipboard.writeText(generatedBotCode);
  
  const btn = document.getElementById('copyBotCode');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Copied!';
  setTimeout(() => btn.innerHTML = originalText, 2000);
}

function saveBotCodeToFile() {
  if (!generatedBotCode) return;
  
  const blob = new Blob([generatedBotCode], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bot_${document.getElementById('assetSelect')?.value || 'custom'}_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

async function fixBotErrorAndRegenerate() {
  const errorInput = document.getElementById('botErrorInput');
  const fixBotErrorBtn = document.getElementById('fixBotError');
  const botCodeOutput = document.getElementById('botCodeOutput');
  
  const error = errorInput?.value?.trim();
  
  if (!error) {
    alert('Please paste the error message first');
    return;
  }
  
  if (!generatedBotCode) {
    alert('Generate a bot first, then paste any errors to fix');
    return;
  }
  
  if (!fixBotErrorBtn) return;
  
  fixBotErrorBtn.disabled = true;
  fixBotErrorBtn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Fixing...';

  try {
    const response = await fetch('/api/fix-bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: generatedBotCode,
        error,
        syntaxRules: PROREALTIME_SYNTAX_RULES
      })
    });

    if (!response.ok) {
      throw new Error('Server error: ' + response.status);
    }

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    generatedBotCode = data.code;
    if (botCodeOutput) {
      botCodeOutput.textContent = generatedBotCode;
    }
    errorInput.value = '';

  } catch (err) {
    alert('Error fixing bot: ' + err.message);
  } finally {
    fixBotErrorBtn.disabled = false;
    fixBotErrorBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Fix Error & Regenerate';
  }
}

export function updateChartTheme() {
  if (!chart || !initialized) return;
  
  try {
    const isDark = document.documentElement.classList.contains('dark');
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: isDark ? '#1f2937' : '#111827' },
        textColor: isDark ? '#9ca3af' : '#d1d5db',
      },
    });
  } catch (e) {
    console.warn('Could not update chart theme:', e);
  }
}

function handleScreenshotFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    screenshotBase64 = e.target.result;
    showScreenshotPreview(screenshotBase64);
  };
  reader.readAsDataURL(file);
}

function showScreenshotPreview(dataUrl) {
  const placeholder = document.getElementById('screenshotPlaceholder');
  const preview = document.getElementById('screenshotPreview');
  const image = document.getElementById('screenshotImage');
  const clearBtn = document.getElementById('clearScreenshot');
  
  if (placeholder) placeholder.classList.add('hidden');
  if (preview) {
    preview.classList.remove('hidden');
    image.src = dataUrl;
  }
  if (clearBtn) clearBtn.classList.remove('hidden');
}

function clearScreenshot() {
  screenshotBase64 = null;
  const placeholder = document.getElementById('screenshotPlaceholder');
  const preview = document.getElementById('screenshotPreview');
  const clearBtn = document.getElementById('clearScreenshot');
  const input = document.getElementById('screenshotInput');
  
  if (placeholder) placeholder.classList.remove('hidden');
  if (preview) preview.classList.add('hidden');
  if (clearBtn) clearBtn.classList.add('hidden');
  if (input) input.value = '';
}

export async function loadBotHistory() {
  try {
    const response = await fetch('/api/bot-history');
    const data = await response.json();
    
    const historyList = document.getElementById('botHistoryList');
    if (!historyList) return;
    
    if (!data.entries || data.entries.length === 0) {
      historyList.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400 p-2">No bots generated yet</p>';
      return;
    }
    
    historyList.innerHTML = data.entries.map(entry => {
      const date = new Date(entry.createdAt).toLocaleDateString();
      const assetLabel = entry.asset?.toUpperCase() || 'Unknown';
      const strategyLabel = entry.strategy || 'custom';
      
      return `
        <div class="history-item group p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-600" data-id="${entry.id}">
          <div class="flex items-center justify-between">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">${assetLabel} - ${strategyLabel}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">${date}</p>
            </div>
            ${entry.hasScreenshot ? '<svg class="w-4 h-4 text-blue-500 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>' : ''}
            <button class="delete-bot-btn opacity-0 group-hover:opacity-100 ml-2 p-1 text-red-500 hover:text-red-600 transition-all" data-id="${entry.id}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
    
  } catch (e) {
    console.warn('Failed to load bot history:', e);
  }
}

async function loadBotEntry(id) {
  try {
    const response = await fetch(`/api/bot-history/${id}`);
    const data = await response.json();
    
    if (data.error) return;
    
    generatedBotCode = data.code;
    const botOutputSection = document.getElementById('botOutputSection');
    const botCodeOutput = document.getElementById('botCodeOutput');
    
    if (botCodeOutput) botCodeOutput.textContent = data.code;
    if (botOutputSection) botOutputSection.classList.remove('hidden');
    
    if (data.asset) {
      const assetSelect = document.getElementById('assetSelect');
      if (assetSelect) assetSelect.value = data.asset;
    }
    if (data.strategy) {
      const strategyType = document.getElementById('strategyType');
      if (strategyType) strategyType.value = data.strategy;
    }
    
  } catch (e) {
    console.warn('Failed to load bot entry:', e);
  }
}

async function deleteBotEntry(id) {
  if (!confirm('Delete this bot?')) return;
  
  try {
    await fetch(`/api/bot-history/${id}`, { method: 'DELETE' });
    loadBotHistory();
  } catch (e) {
    console.warn('Failed to delete bot entry:', e);
  }
}

export function initScreenshotHandlers() {
  const dropZone = document.getElementById('screenshotDropZone');
  const input = document.getElementById('screenshotInput');
  const clearBtn = document.getElementById('clearScreenshot');
  
  if (dropZone) {
    dropZone.addEventListener('click', () => input?.click());
    
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('border-blue-400', 'dark:border-blue-500');
    });
    
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('border-blue-400', 'dark:border-blue-500');
    });
    
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('border-blue-400', 'dark:border-blue-500');
      const file = e.dataTransfer.files[0];
      handleScreenshotFile(file);
    });
  }
  
  if (input) {
    input.addEventListener('change', (e) => {
      handleScreenshotFile(e.target.files[0]);
    });
  }
  
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearScreenshot();
    });
  }
  
  document.addEventListener('paste', (e) => {
    const botTabContent = document.getElementById('botTabContent');
    if (botTabContent?.classList.contains('hidden')) return;
    
    const items = e.clipboardData?.items;
    if (!items) return;
    
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        handleScreenshotFile(file);
        break;
      }
    }
  });
  
  const historyList = document.getElementById('botHistoryList');
  if (historyList) {
    historyList.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.delete-bot-btn');
      if (deleteBtn) {
        e.stopPropagation();
        deleteBotEntry(deleteBtn.dataset.id);
        return;
      }
      
      const historyItem = e.target.closest('.history-item');
      if (historyItem) {
        loadBotEntry(historyItem.dataset.id);
      }
    });
  }
}
