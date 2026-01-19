import { createChart, ColorType, LineStyle, CrosshairMode, CandlestickSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';

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
let equityChart = null;
let tradeChart = null;
let tradeCandleSeries = null;
let currentBotId = null;
let detectedVariables = [];

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

const CACHE_TTL_MS = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000
};

function getLocalStorageCache(key) {
  try {
    const cached = localStorage.getItem(`market_${key}`);
    if (!cached) return null;
    const { data, timestamp, timeframe } = JSON.parse(cached);
    const ttl = CACHE_TTL_MS[timeframe] || 60 * 60 * 1000;
    if (Date.now() - timestamp > ttl) {
      localStorage.removeItem(`market_${key}`);
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

function setLocalStorageCache(key, data, timeframe) {
  try {
    localStorage.setItem(`market_${key}`, JSON.stringify({
      data,
      timestamp: Date.now(),
      timeframe
    }));
  } catch (e) {
    console.warn('Failed to cache to localStorage:', e);
  }
}

async function fetchMarketData(asset, timeframe = '1h', forceRefresh = false) {
  const cacheKey = `${asset}_${timeframe}`;
  
  if (!forceRefresh) {
    if (cachedData[cacheKey]) {
      return cachedData[cacheKey];
    }
    
    const localCached = getLocalStorageCache(cacheKey);
    if (localCached) {
      cachedData[cacheKey] = localCached;
      console.log(`Using localStorage cache for ${cacheKey}`);
      return localCached;
    }
  }
  
  try {
    const url = forceRefresh 
      ? `/api/market-data/${asset}/${timeframe}?refresh=true`
      : `/api/market-data/${asset}/${timeframe}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.error) {
      console.warn('API returned error:', data.error);
      return FALLBACK_DATA[asset] || FALLBACK_DATA.silver;
    }
    
    if (data.candles && data.candles.length > 0) {
      cachedData[cacheKey] = data.candles;
      setLocalStorageCache(cacheKey, data.candles, timeframe);
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

  const data = await fetchMarketData('silver', '1m');
  candleSeries.setData(data);
  chart.timeScale().fitContent();
  
  const assetSelect = document.getElementById('assetSelect');
  if (assetSelect) assetSelect.value = 'silver';
  const timeframeSelect = document.getElementById('timeframeSelect');
  if (timeframeSelect) timeframeSelect.value = '1m';

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
    initialCapital: parseFloat(document.getElementById('initialCapital')?.value) || 2000,
    maxPositionSize: parseFloat(document.getElementById('maxPositionSize')?.value) || 1,
    useOrderFee: document.getElementById('useOrderFee')?.checked ?? true,
    orderFee: parseFloat(document.getElementById('orderFee')?.value) || 7,
    useSpread: document.getElementById('useSpread')?.checked ?? true,
    spreadPips: parseFloat(document.getElementById('spreadPips')?.value) || 2,
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
    drawings: drawings,
    timezone: document.getElementById('timezone')?.value || 'Australia/Brisbane',
    excludeWeekends: document.getElementById('excludeWeekends')?.checked ?? true,
    excludeHolidays: document.getElementById('excludeHolidays')?.checked ?? true,
    useTimeFilter: document.getElementById('useTimeFilter')?.checked ?? true,
    tradingStartTime: document.getElementById('tradingStartTime')?.value || '09:00',
    tradingEndTime: document.getElementById('tradingEndTime')?.value || '17:00',
    excludeOpenPeriod: document.getElementById('excludeOpenPeriod')?.checked ?? true,
    openPeriodMinutes: parseInt(document.getElementById('openPeriodMinutes')?.value) || 30,
    excludeClosePeriod: document.getElementById('excludeClosePeriod')?.checked ?? true,
    closePeriodMinutes: parseInt(document.getElementById('closePeriodMinutes')?.value) || 30,
    closeBeforeEnd: document.getElementById('closeBeforeEnd')?.checked || false,
    closeBeforeMinutes: parseInt(document.getElementById('closeBeforeMinutes')?.value) || 15,
    tradeDays: {
      mon: document.getElementById('tradeMon')?.checked ?? true,
      tue: document.getElementById('tradeTue')?.checked ?? true,
      wed: document.getElementById('tradeWed')?.checked ?? true,
      thu: document.getElementById('tradeThu')?.checked ?? true,
      fri: document.getElementById('tradeFri')?.checked ?? true,
      sat: document.getElementById('tradeSat')?.checked || false,
      sun: document.getElementById('tradeSun')?.checked || false
    }
  };
}

function buildBotDescription(settings) {
  let desc = `Generate a ProRealTime/ProBuilder trading bot with the following specifications:\n\n`;
  
  desc += `ASSET: ${settings.asset.toUpperCase()}\n`;
  desc += `TIMEFRAME: ${settings.timeframe}\n\n`;
  
  desc += `CAPITAL & FEES:\n`;
  desc += `- Initial capital: $${settings.initialCapital}\n`;
  desc += `- Maximum position size: ${settings.maxPositionSize}\n`;
  if (settings.useOrderFee) {
    desc += `- Order fee: $${settings.orderFee} per order\n`;
  }
  if (settings.useSpread) {
    desc += `- Spread: ${settings.spreadPips} pips\n`;
  }
  desc += `\n`;
  
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
  
  desc += `STRATEGY: ${settings.strategyType}\n\n`;
  
  desc += `TIME & SESSION FILTERS:\n`;
  desc += `- Timezone: ${settings.timezone}\n`;
  if (settings.excludeWeekends) {
    desc += `- Exclude weekends (Saturday & Sunday)\n`;
  }
  if (settings.excludeHolidays) {
    desc += `- Exclude major market holidays\n`;
  }
  if (settings.useTimeFilter) {
    desc += `- Trading hours: ${settings.tradingStartTime} to ${settings.tradingEndTime}\n`;
  }
  if (settings.excludeOpenPeriod) {
    desc += `- Exclude first ${settings.openPeriodMinutes} minutes of session (avoid opening volatility)\n`;
  }
  if (settings.excludeClosePeriod) {
    desc += `- Exclude last ${settings.closePeriodMinutes} minutes of session (avoid closing volatility)\n`;
  }
  if (settings.closeBeforeEnd) {
    desc += `- Force close all positions ${settings.closeBeforeMinutes} minutes before session end\n`;
  }
  
  const tradeDayNames = [];
  if (settings.tradeDays.mon) tradeDayNames.push('Mon');
  if (settings.tradeDays.tue) tradeDayNames.push('Tue');
  if (settings.tradeDays.wed) tradeDayNames.push('Wed');
  if (settings.tradeDays.thu) tradeDayNames.push('Thu');
  if (settings.tradeDays.fri) tradeDayNames.push('Fri');
  if (settings.tradeDays.sat) tradeDayNames.push('Sat');
  if (settings.tradeDays.sun) tradeDayNames.push('Sun');
  desc += `- Active trading days: ${tradeDayNames.join(', ')}\n`;
  
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
    currentBotId = data.entryId;
    botCodeOutput.textContent = generatedBotCode;
    botOutputSection.classList.remove('hidden');
    
    loadBotHistory();
    
    const optPanel = document.getElementById('variableOptPanel');
    if (optPanel) optPanel.classList.remove('hidden');
    detectAndDisplayVariables();
    showCodeVariableSliders();

  } catch (err) {
    alert('Error generating bot: ' + err.message);
  } finally {
    generateBotBtn.disabled = false;
    generateBotBtn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg> Generate ProRealTime Bot Code';
  }
}

async function copyBotCodeToClipboard() {
  const botCodeOutput = document.getElementById('botCodeOutput');
  const codeText = botCodeOutput?.textContent || generatedBotCode;
  if (!codeText) return;
  
  await navigator.clipboard.writeText(codeText);
  
  const btn = document.getElementById('copyBotCode');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Copied!';
  setTimeout(() => btn.innerHTML = originalText, 2000);
}

function showCodeVariableSliders() {
  const panel = document.getElementById('codeVariablePanel');
  const container = document.getElementById('codeVariableSlidersContainer');
  
  if (!generatedBotCode || !panel || !container) return;
  
  detectedVariables = detectBotVariables(generatedBotCode);
  
  if (detectedVariables.length === 0) {
    panel.classList.add('hidden');
    return;
  }
  
  container.innerHTML = detectedVariables.map((v, i) => `
    <div class="flex items-center gap-2 bg-white dark:bg-gray-700 rounded-lg p-2 border border-gray-200 dark:border-gray-600">
      <span class="text-xs font-mono text-indigo-600 dark:text-indigo-400 w-20 truncate" title="${v.name}">${v.name}</span>
      <input type="range" 
        id="codeVarSlider_${i}" 
        data-var-index="${i}"
        min="${v.min}" 
        max="${v.max}" 
        step="${v.step}" 
        value="${v.currentValue}"
        class="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-600 accent-indigo-600">
      <input type="number" 
        id="codeVarInput_${i}"
        data-var-index="${i}"
        min="${v.min}" 
        max="${v.max}" 
        step="${v.step}" 
        value="${v.currentValue}"
        class="w-16 px-1 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
      <span class="text-xs text-gray-400">(${v.originalValue})</span>
    </div>
  `).join('');
  
  detectedVariables.forEach((v, i) => {
    const slider = document.getElementById(`codeVarSlider_${i}`);
    const input = document.getElementById(`codeVarInput_${i}`);
    
    const updateCode = () => {
      const modifiedCode = applyVariablesToCode(generatedBotCode, detectedVariables);
      const botCodeOutput = document.getElementById('botCodeOutput');
      if (botCodeOutput) botCodeOutput.textContent = modifiedCode;
      debouncedSaveVariables();
    };
    
    slider?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      detectedVariables[i].currentValue = val;
      if (input) input.value = val;
      updateCode();
    });
    
    input?.addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      detectedVariables[i].currentValue = val;
      if (slider) slider.value = val;
      updateCode();
    });
  });
  
  panel.classList.remove('hidden');
}

function resetVariablesToOriginal() {
  detectedVariables.forEach((v, i) => {
    v.currentValue = v.originalValue;
    const slider = document.getElementById(`codeVarSlider_${i}`);
    const input = document.getElementById(`codeVarInput_${i}`);
    if (slider) slider.value = v.originalValue;
    if (input) input.value = v.originalValue;
  });
  
  const botCodeOutput = document.getElementById('botCodeOutput');
  if (botCodeOutput) botCodeOutput.textContent = generatedBotCode;
  
  saveVariableOverrides();
}

function showCodeVariableSlidersFromData(variables) {
  const panel = document.getElementById('codeVariablePanel');
  const container = document.getElementById('codeVariableSlidersContainer');
  
  if (!panel || !container || variables.length === 0) {
    if (panel) panel.classList.add('hidden');
    return;
  }
  
  container.innerHTML = variables.map((v, i) => `
    <div class="flex items-center gap-2 bg-white dark:bg-gray-700 rounded-lg p-2 border border-gray-200 dark:border-gray-600">
      <span class="text-xs font-mono text-indigo-600 dark:text-indigo-400 w-20 truncate" title="${v.name}">${v.name}</span>
      <input type="range" 
        id="codeVarSlider_${i}" 
        data-var-index="${i}"
        min="${v.min}" 
        max="${v.max}" 
        step="${v.step}" 
        value="${v.currentValue}"
        class="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-600 accent-indigo-600">
      <input type="number" 
        id="codeVarInput_${i}"
        data-var-index="${i}"
        min="${v.min}" 
        max="${v.max}" 
        step="${v.step}" 
        value="${v.currentValue}"
        class="w-16 px-1 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
      <span class="text-xs text-gray-400">(${v.originalValue})</span>
    </div>
  `).join('');
  
  variables.forEach((v, i) => {
    const slider = document.getElementById(`codeVarSlider_${i}`);
    const input = document.getElementById(`codeVarInput_${i}`);
    
    const updateCode = () => {
      const modifiedCode = applyVariablesToCode(generatedBotCode, detectedVariables);
      const botCodeOutput = document.getElementById('botCodeOutput');
      if (botCodeOutput) botCodeOutput.textContent = modifiedCode;
      debouncedSaveVariables();
    };
    
    slider?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      detectedVariables[i].currentValue = val;
      if (input) input.value = val;
      updateCode();
    });
    
    input?.addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      detectedVariables[i].currentValue = val;
      if (slider) slider.value = val;
      updateCode();
    });
  });
  
  panel.classList.remove('hidden');
}

let saveVariablesTimeout = null;
function debouncedSaveVariables() {
  if (saveVariablesTimeout) clearTimeout(saveVariablesTimeout);
  saveVariablesTimeout = setTimeout(saveVariableOverrides, 500);
}

async function saveVariableOverrides() {
  if (!currentBotId || detectedVariables.length === 0) return;
  
  try {
    const modifiedCode = applyVariablesToCode(generatedBotCode, detectedVariables);
    await fetch(`/api/bot-history/${currentBotId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variableOverrides: detectedVariables,
        modifiedCode: modifiedCode
      })
    });
  } catch (e) {
    console.warn('Failed to save variable overrides:', e);
  }
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
    
    currentBotId = id;
    generatedBotCode = data.code;
    const botOutputSection = document.getElementById('botOutputSection');
    const botCodeOutput = document.getElementById('botCodeOutput');
    
    if (data.asset) {
      const assetSelect = document.getElementById('assetSelect');
      if (assetSelect) assetSelect.value = data.asset;
    }
    if (data.strategy) {
      const strategyType = document.getElementById('strategyType');
      if (strategyType) strategyType.value = data.strategy;
    }
    
    if (data.variableOverrides && data.variableOverrides.length > 0) {
      detectedVariables = data.variableOverrides;
      const modifiedCode = applyVariablesToCode(generatedBotCode, detectedVariables);
      if (botCodeOutput) botCodeOutput.textContent = modifiedCode;
      showCodeVariableSlidersFromData(detectedVariables);
    } else {
      if (botCodeOutput) botCodeOutput.textContent = data.code;
      showCodeVariableSliders();
    }
    
    if (botOutputSection) botOutputSection.classList.remove('hidden');
    
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
  
  setupBotSubTabs();
  setupSimulator();
}

function setupBotSubTabs() {
  const settingsTabBtn = document.getElementById('botSettingsTabBtn');
  const simulatorTabBtn = document.getElementById('botSimulatorTabBtn');
  const settingsContent = document.getElementById('botSettingsTabContent');
  const simulatorContent = document.getElementById('botSimulatorTabContent');
  
  if (settingsTabBtn && simulatorTabBtn) {
    settingsTabBtn.addEventListener('click', () => {
      settingsTabBtn.className = 'bot-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300';
      simulatorTabBtn.className = 'bot-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700';
      if (settingsContent) settingsContent.classList.remove('hidden');
      if (simulatorContent) simulatorContent.classList.add('hidden');
    });
    
    simulatorTabBtn.addEventListener('click', () => {
      simulatorTabBtn.className = 'bot-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300';
      settingsTabBtn.className = 'bot-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700';
      if (settingsContent) settingsContent.classList.add('hidden');
      if (simulatorContent) simulatorContent.classList.remove('hidden');
    });
  }
}

let currentCandles = [];
let lastSimulationResults = null;
let optimizationResults = [];

function setupSimulator() {
  const runBtn = document.getElementById('runSimulatorBtn');
  if (runBtn) {
    runBtn.addEventListener('click', runSimulation);
  }
  
  const downloadBtn = document.getElementById('downloadResultsBtn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadResultsJSON);
  }
  
  const toggleRawBtn = document.getElementById('toggleRawDataBtn');
  if (toggleRawBtn) {
    toggleRawBtn.addEventListener('click', toggleRawDataPanel);
  }
  
  const detectVarsBtn = document.getElementById('detectVariablesBtn');
  if (detectVarsBtn) {
    detectVarsBtn.addEventListener('click', detectAndDisplayVariables);
  }
  
  const autoOptBtn = document.getElementById('autoOptimizeBtn');
  if (autoOptBtn) {
    autoOptBtn.addEventListener('click', runAutoOptimization);
  }
  
  const runModBtn = document.getElementById('runModifiedBtn');
  if (runModBtn) {
    runModBtn.addEventListener('click', runSimulationWithModifiedVars);
  }
  
  const runModBtn2 = document.getElementById('runModifiedBtn2');
  if (runModBtn2) {
    runModBtn2.addEventListener('click', runSimulationWithModifiedVars);
  }
  
  const resetVarsBtn = document.getElementById('resetVariablesBtn');
  if (resetVarsBtn) {
    resetVarsBtn.addEventListener('click', resetVariablesToOriginal);
  }
}

async function runSimulationWithModifiedVars() {
  const runBtn = document.getElementById('runModifiedBtn');
  const statusEl = document.getElementById('simulatorStatus');
  const noResultsEl = document.getElementById('simulatorNoResults');
  const resultsEl = document.getElementById('simulatorResults');
  
  if (!generatedBotCode) {
    alert('Please generate a bot first.');
    return;
  }
  
  if (detectedVariables.length === 0) {
    alert('No variables detected. Click "Detect Variables" first.');
    return;
  }
  
  runBtn.disabled = true;
  runBtn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';
  
  if (statusEl) {
    statusEl.classList.remove('hidden');
    statusEl.textContent = 'Running simulation with modified variables...';
    statusEl.className = 'mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm';
  }
  
  try {
    const settings = getSettings();
    const asset = document.getElementById('assetSelect')?.value || 'silver';
    const timeframe = document.getElementById('timeframeSelect')?.value || '1m';
    
    const candles = await fetchMarketData(asset, timeframe);
    currentCandles = candles;
    
    const results = await runSimulationWithVariables(detectedVariables, candles, settings);
    
    if (results.error) {
      if (statusEl) {
        statusEl.textContent = `Error: ${results.error}`;
        statusEl.className = 'mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm';
      }
      return;
    }
    
    displaySimulationResults(results);
    
    if (statusEl) statusEl.classList.add('hidden');
    if (noResultsEl) noResultsEl.classList.add('hidden');
    if (resultsEl) resultsEl.classList.remove('hidden');
    
  } catch (e) {
    console.error('Simulation error:', e);
    if (statusEl) {
      statusEl.textContent = `Error: ${e.message}`;
      statusEl.className = 'mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm';
    }
  } finally {
    runBtn.disabled = false;
    runBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/>
    </svg> Run Modified`;
  }
}

function detectBotVariables(code) {
  const variables = [];
  const lines = code.split('\n');
  
  const patterns = [
    { regex: /(\w+)\s*=\s*(\d+\.?\d*)\s*(?:\/\/.*)?$/i, type: 'assignment' },
    { regex: /ONCE\s+(\w+)\s*=\s*(\d+\.?\d*)/i, type: 'once' },
    { regex: /SET\s+STOP\s+(?:P)?LOSS\s+(\d+\.?\d*)/i, name: 'StopLoss', type: 'stopLoss' },
    { regex: /SET\s+TARGET\s+(?:P)?PROFIT\s+(\d+\.?\d*)/i, name: 'TakeProfit', type: 'takeProfit' },
    { regex: /Average\[(\d+)\]/gi, name: 'AvgPeriod', type: 'indicator' },
    { regex: /ExponentialAverage\[(\d+)\]/gi, name: 'EMAPeriod', type: 'indicator' },
    { regex: /RSI\[(\d+)\]/gi, name: 'RSIPeriod', type: 'indicator' },
    { regex: /Summation\[.*?,\s*(\d+)\]/gi, name: 'SumPeriod', type: 'indicator' }
  ];
  
  const seen = new Set();
  
  lines.forEach((line, idx) => {
    if (line.trim().startsWith('//')) return;
    
    patterns.forEach(p => {
      const matches = [...line.matchAll(new RegExp(p.regex.source, 'gi'))];
      matches.forEach(match => {
        let name, value;
        if (p.type === 'assignment' || p.type === 'once') {
          name = match[1];
          value = parseFloat(match[2]);
        } else if (p.type === 'stopLoss' || p.type === 'takeProfit') {
          name = p.name;
          value = parseFloat(match[1]);
        } else {
          name = `${p.name}_${idx}`;
          value = parseFloat(match[1]);
        }
        
        if (!seen.has(name) && !isNaN(value) && value > 0) {
          const reserved = ['Open', 'High', 'Low', 'Close', 'Volume', 'BarIndex', 'Date', 'Time'];
          if (!reserved.includes(name)) {
            seen.add(name);
            const decimals = (String(value).split('.')[1] || '').length;
            const precision = Math.pow(10, -decimals);
            let min, max, step;
            
            if (value < 1) {
              min = Math.max(precision, value * 0.1);
              max = value * 5;
              step = precision;
            } else if (value < 10) {
              min = Math.max(0.1, value * 0.2);
              max = value * 3;
              step = decimals > 0 ? precision : 0.1;
            } else if (value < 100) {
              min = Math.max(1, Math.floor(value * 0.2));
              max = Math.ceil(value * 3);
              step = 1;
            } else {
              min = Math.max(10, Math.floor(value * 0.2));
              max = Math.ceil(value * 3);
              step = 10;
            }
            
            variables.push({
              name,
              originalValue: value,
              currentValue: value,
              min,
              max,
              step,
              lineIndex: idx,
              pattern: match[0]
            });
          }
        }
      });
    });
  });
  
  return variables;
}

function detectAndDisplayVariables() {
  const panel = document.getElementById('variableOptPanel');
  const container = document.getElementById('variableSlidersContainer');
  
  if (!generatedBotCode) {
    container.innerHTML = '<p class="text-sm text-red-500">Please generate a bot first.</p>';
    if (panel) panel.classList.remove('hidden');
    return;
  }
  
  detectedVariables = detectBotVariables(generatedBotCode);
  
  if (detectedVariables.length === 0) {
    container.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400 italic">No adjustable variables detected in the bot code.</p>';
    if (panel) panel.classList.remove('hidden');
    return;
  }
  
  container.innerHTML = detectedVariables.map((v, i) => `
    <div class="flex items-center gap-3 bg-white dark:bg-gray-700 rounded-lg p-2 border border-gray-200 dark:border-gray-600">
      <span class="text-xs font-mono text-indigo-600 dark:text-indigo-400 w-24 truncate" title="${v.name}">${v.name}</span>
      <input type="range" 
        id="varSlider_${i}" 
        data-var-index="${i}"
        min="${v.min}" 
        max="${v.max}" 
        step="${v.step}" 
        value="${v.currentValue}"
        class="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-600 accent-indigo-600">
      <input type="number" 
        id="varInput_${i}"
        data-var-index="${i}"
        min="${v.min}" 
        max="${v.max}" 
        step="${v.step}" 
        value="${v.currentValue}"
        class="w-20 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
      <span class="text-xs text-gray-400">(${v.originalValue})</span>
    </div>
  `).join('');
  
  detectedVariables.forEach((v, i) => {
    const slider = document.getElementById(`varSlider_${i}`);
    const input = document.getElementById(`varInput_${i}`);
    
    slider?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      detectedVariables[i].currentValue = val;
      if (input) input.value = val;
    });
    
    input?.addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      detectedVariables[i].currentValue = val;
      if (slider) slider.value = val;
    });
  });
  
  if (panel) panel.classList.remove('hidden');
  
  const runModBtn = document.getElementById('runModifiedBtn');
  const runModBtn2 = document.getElementById('runModifiedBtn2');
  if (detectedVariables.length > 0) {
    if (runModBtn) runModBtn.classList.remove('hidden');
    if (runModBtn2) runModBtn2.classList.remove('hidden');
  }
}

function applyVariablesToCode(code, variables) {
  let modifiedCode = code;
  
  variables.forEach(v => {
    const escapedPattern = v.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const newPattern = v.pattern.replace(String(v.originalValue), String(v.currentValue));
    modifiedCode = modifiedCode.replace(new RegExp(escapedPattern), newPattern);
  });
  
  return modifiedCode;
}

async function runSimulationWithVariables(variables, candles, settings) {
  const modifiedCode = applyVariablesToCode(generatedBotCode, variables);
  
  const response = await fetch('/api/simulate-bot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: modifiedCode,
      candles,
      settings
    })
  });
  
  return await response.json();
}

async function runAutoOptimization() {
  const btn = document.getElementById('autoOptimizeBtn');
  const progressDiv = document.getElementById('optimizeProgress');
  const progressBar = document.getElementById('optimizeProgressBar');
  const progressText = document.getElementById('optimizeProgressText');
  const progressPercent = document.getElementById('optimizeProgressPercent');
  const resultsPanel = document.getElementById('bestResultsPanel');
  const resultsList = document.getElementById('bestResultsList');
  
  if (!generatedBotCode || detectedVariables.length === 0) {
    alert('Please generate a bot and detect variables first.');
    return;
  }
  
  const iterations = parseInt(document.getElementById('optimizeIterations')?.value) || 20;
  const metric = document.getElementById('optimizeMetric')?.value || 'totalGain';
  
  btn.disabled = true;
  progressDiv?.classList.remove('hidden');
  optimizationResults = [];
  
  const settings = getSettings();
  const asset = document.getElementById('assetSelect')?.value || 'silver';
  const timeframe = document.getElementById('timeframeSelect')?.value || '1m';
  
  try {
    const candles = await fetchMarketData(asset, timeframe);
    currentCandles = candles;
    
    for (let i = 0; i < iterations; i++) {
      const testVars = detectedVariables.map(v => ({
        ...v,
        currentValue: v.min + Math.random() * (v.max - v.min)
      }));
      
      testVars.forEach(v => {
        v.currentValue = Math.round(v.currentValue / v.step) * v.step;
      });
      
      const progress = ((i + 1) / iterations) * 100;
      if (progressBar) progressBar.style.width = `${progress}%`;
      if (progressText) progressText.textContent = `Running iteration ${i + 1} of ${iterations}...`;
      if (progressPercent) progressPercent.textContent = `${Math.round(progress)}%`;
      
      try {
        const result = await runSimulationWithVariables(testVars, candles, settings);
        
        if (!result.error) {
          let score;
          switch (metric) {
            case 'winRate': score = result.winRate || 0; break;
            case 'gainLossRatio': score = result.gainLossRatio || 0; break;
            case 'sharpe': score = (result.totalGain || 0) / Math.max(1, Math.abs(result.maxDrawdown || 1)); break;
            default: score = result.totalGain || 0;
          }
          
          optimizationResults.push({
            variables: testVars.map(v => ({ name: v.name, value: v.currentValue })),
            result,
            score,
            metric
          });
        }
      } catch (e) {
        console.warn(`Iteration ${i + 1} failed:`, e);
      }
      
      await new Promise(r => setTimeout(r, 50));
    }
    
    optimizationResults.sort((a, b) => b.score - a.score);
    
    displayOptimizationResults();
    
    if (progressText) progressText.textContent = `Completed ${iterations} iterations!`;
    
  } catch (e) {
    console.error('Optimization error:', e);
    alert('Optimization failed: ' + e.message);
  } finally {
    btn.disabled = false;
  }
}

function displayOptimizationResults() {
  const panel = document.getElementById('bestResultsPanel');
  const list = document.getElementById('bestResultsList');
  
  if (!panel || !list) return;
  
  const top5 = optimizationResults.slice(0, 5);
  
  if (top5.length === 0) {
    list.innerHTML = '<p class="text-sm text-gray-500">No valid results found.</p>';
    panel.classList.remove('hidden');
    return;
  }
  
  const formatMoney = (v) => {
    const sign = v >= 0 ? '+' : '';
    return `${sign}$${v.toFixed(2)}`;
  };
  
  list.innerHTML = top5.map((r, i) => `
    <div class="flex items-center gap-3 p-2 rounded-lg ${i === 0 ? 'bg-green-100 dark:bg-green-800/30 border border-green-300 dark:border-green-600' : 'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600'} cursor-pointer hover:shadow-md transition-shadow" data-result-index="${i}">
      <span class="w-6 h-6 flex items-center justify-center rounded-full ${i === 0 ? 'bg-green-500 text-white' : 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300'} text-xs font-bold">${i + 1}</span>
      <div class="flex-1">
        <div class="flex items-center gap-2 text-sm">
          <span class="${r.result.totalGain >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} font-medium">${formatMoney(r.result.totalGain)}</span>
          <span class="text-gray-400">|</span>
          <span class="text-blue-600 dark:text-blue-400">${r.result.winRate?.toFixed(1)}% win</span>
          <span class="text-gray-400">|</span>
          <span class="text-purple-600 dark:text-purple-400">${r.result.totalTrades} trades</span>
        </div>
        <div class="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
          ${r.variables.map(v => `${v.name}=${v.value.toFixed(2)}`).join(', ')}
        </div>
      </div>
      <button class="apply-result-btn px-2 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors" data-result-index="${i}">Apply</button>
    </div>
  `).join('');
  
  list.querySelectorAll('.apply-result-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.resultIndex);
      applyOptimizationResult(idx);
    });
  });
  
  panel.classList.remove('hidden');
}

function applyOptimizationResult(index) {
  const result = optimizationResults[index];
  if (!result) return;
  
  result.variables.forEach(v => {
    const varIdx = detectedVariables.findIndex(dv => dv.name === v.name);
    if (varIdx >= 0) {
      detectedVariables[varIdx].currentValue = v.value;
      
      const slider = document.getElementById(`varSlider_${varIdx}`);
      const input = document.getElementById(`varInput_${varIdx}`);
      if (slider) slider.value = v.value;
      if (input) input.value = v.value;
    }
  });
  
  displaySimulationResults(result.result);
  
  const noResultsEl = document.getElementById('simulatorNoResults');
  const resultsEl = document.getElementById('simulatorResults');
  if (noResultsEl) noResultsEl.classList.add('hidden');
  if (resultsEl) resultsEl.classList.remove('hidden');
}

function toggleRawDataPanel() {
  const panel = document.getElementById('rawDataPanel');
  const chevron = document.getElementById('rawDataChevron');
  
  if (panel && chevron) {
    panel.classList.toggle('hidden');
    chevron.classList.toggle('rotate-180');
  }
}

function downloadResultsJSON() {
  if (!lastSimulationResults) {
    alert('No simulation results to download. Run a backtest first.');
    return;
  }
  
  const dataStr = JSON.stringify(lastSimulationResults, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `backtest_results_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function runSimulation() {
  const runBtn = document.getElementById('runSimulatorBtn');
  const statusEl = document.getElementById('simulatorStatus');
  const noResultsEl = document.getElementById('simulatorNoResults');
  const resultsEl = document.getElementById('simulatorResults');
  
  if (!generatedBotCode) {
    alert('Please generate a bot first before running the simulation.');
    return;
  }
  
  runBtn.disabled = true;
  runBtn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Running...';
  
  if (statusEl) {
    statusEl.classList.remove('hidden');
    statusEl.textContent = 'Running simulation...';
  }
  
  try {
    const settings = getSettings();
    const asset = document.getElementById('assetSelect')?.value || 'silver';
    const timeframe = document.getElementById('timeframeSelect')?.value || '1m';
    
    const candles = await fetchMarketData(asset, timeframe);
    currentCandles = candles;
    
    const response = await fetch('/api/simulate-bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: generatedBotCode,
        candles,
        settings
      })
    });
    
    const results = await response.json();
    
    if (results.error) {
      if (statusEl) {
        statusEl.textContent = `Error: ${results.error}`;
        statusEl.className = 'mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm';
      }
      return;
    }
    
    displaySimulationResults(results);
    
    if (statusEl) statusEl.classList.add('hidden');
    if (noResultsEl) noResultsEl.classList.add('hidden');
    if (resultsEl) resultsEl.classList.remove('hidden');
    
  } catch (e) {
    console.error('Simulation error:', e);
    if (statusEl) {
      statusEl.textContent = `Error: ${e.message}`;
      statusEl.className = 'mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm';
    }
  } finally {
    runBtn.disabled = false;
    runBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg> Run Backtest`;
  }
}

function displaySimulationResults(r) {
  lastSimulationResults = r;
  
  const downloadBtn = document.getElementById('downloadResultsBtn');
  if (downloadBtn) {
    downloadBtn.classList.remove('hidden');
  }
  
  const rawDataContent = document.getElementById('rawDataContent');
  if (rawDataContent) {
    rawDataContent.textContent = JSON.stringify(r, null, 2);
  }
  
  const formatMoney = (v) => {
    const sign = v >= 0 ? '' : '-';
    return `${sign}$${Math.abs(v).toFixed(2)}`;
  };
  
  createEquityCurveChart(r.equity || []);
  createTradeAnalysisChart(r.trades || [], currentCandles);
  
  document.getElementById('simTotalGain').textContent = formatMoney(r.totalGain);
  document.getElementById('simTotalGain').className = `text-2xl font-bold ${r.totalGain >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`;
  
  document.getElementById('simWinRate').textContent = `${r.winRate.toFixed(1)}%`;
  document.getElementById('simGainLossRatio').textContent = r.gainLossRatio.toFixed(2);
  document.getElementById('simTotalTrades').textContent = r.totalTrades;
  
  const winCircle = document.getElementById('winRateCircle');
  const circumference = 2 * Math.PI * 40;
  const dashArray = (r.winRate / 100) * circumference;
  winCircle.setAttribute('stroke-dasharray', `${dashArray} ${circumference}`);
  document.getElementById('winRatePercent').textContent = `${r.winRate.toFixed(0)}%`;
  
  document.getElementById('simWinningTrades').textContent = r.winningTrades;
  document.getElementById('simNeutralTrades').textContent = r.neutralTrades;
  document.getElementById('simLosingTrades').textContent = r.losingTrades;
  
  document.getElementById('simGainsOnly').textContent = formatMoney(r.gainsOnly);
  document.getElementById('simLossesOnly').textContent = formatMoney(Math.abs(r.lossesOnly));
  
  const maxVal = Math.max(Math.abs(r.gainsOnly), Math.abs(r.lossesOnly)) || 1;
  document.getElementById('gainsBar').style.width = `${(r.gainsOnly / maxVal) * 100}%`;
  document.getElementById('lossesBar').style.width = `${(Math.abs(r.lossesOnly) / maxVal) * 100}%`;
  
  document.getElementById('simAvgGain').textContent = formatMoney(r.avgGainPerTrade);
  document.getElementById('simBestTrade').textContent = formatMoney(r.bestTrade);
  document.getElementById('simWorstTrade').textContent = formatMoney(r.worstTrade);
  
  document.getElementById('simMaxDrawdown').textContent = formatMoney(r.maxDrawdown);
  document.getElementById('simMaxRunup').textContent = formatMoney(r.maxRunup);
  document.getElementById('simTimeInMarket').textContent = `${r.timeInMarket.toFixed(1)}%`;
  document.getElementById('simAvgOrdersDay').textContent = r.avgOrdersPerDay.toFixed(2);
  
  const chartContainer = document.getElementById('performanceChartContainer');
  if (chartContainer && r.dailyPerformance) {
    chartContainer.innerHTML = '';
    const maxDailyGain = Math.max(...r.dailyPerformance.map(d => Math.abs(d.gain)), 1);
    
    r.dailyPerformance.slice(-30).forEach(d => {
      const bar = document.createElement('div');
      const height = (Math.abs(d.gain) / maxDailyGain) * 100;
      const isPositive = d.gain >= 0;
      bar.className = `flex-1 rounded-t ${isPositive ? 'bg-green-500' : 'bg-red-500'}`;
      bar.style.height = `${Math.max(height, 2)}%`;
      bar.title = `${d.date}: ${formatMoney(d.gain)}`;
      chartContainer.appendChild(bar);
    });
  }
}

function createEquityCurveChart(equityData) {
  const container = document.getElementById('equityCurveChart');
  if (!container) return;
  
  if (equityChart) {
    equityChart.remove();
    equityChart = null;
  }
  
  const isDark = document.documentElement.classList.contains('dark');
  
  equityChart = createChart(container, {
    width: container.clientWidth,
    height: 128,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: isDark ? '#9ca3af' : '#6b7280',
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { color: isDark ? '#374151' : '#e5e7eb' },
    },
    rightPriceScale: {
      borderVisible: false,
    },
    timeScale: {
      borderVisible: false,
      timeVisible: false,
    },
    handleScroll: false,
    handleScale: false,
  });
  
  const areaSeries = equityChart.addSeries(LineSeries, {
    color: '#22d3ee',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
    crosshairMarkerVisible: false,
  });
  
  if (equityData && equityData.length > 0) {
    const now = Math.floor(Date.now() / 1000);
    const interval = 60;
    const chartData = equityData.map((val, i) => ({
      time: now - (equityData.length - i) * interval,
      value: val
    }));
    areaSeries.setData(chartData);
  }
  
  equityChart.timeScale().fitContent();
  
  new ResizeObserver(() => {
    if (equityChart) {
      equityChart.applyOptions({ width: container.clientWidth });
    }
  }).observe(container);
}

function createTradeAnalysisChart(trades, candles) {
  const container = document.getElementById('tradeAnalysisChart');
  if (!container || !candles || candles.length === 0) return;
  
  if (tradeChart) {
    tradeChart.remove();
    tradeChart = null;
  }
  
  const isDark = document.documentElement.classList.contains('dark');
  
  tradeChart = createChart(container, {
    width: container.clientWidth,
    height: 256,
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
  
  tradeCandleSeries = tradeChart.addSeries(CandlestickSeries, {
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderUpColor: '#22c55e',
    borderDownColor: '#ef4444',
    wickUpColor: '#22c55e',
    wickDownColor: '#ef4444',
  });
  
  tradeCandleSeries.setData(candles);
  
  if (trades && trades.length > 0) {
    const tradeMarkers = [];
    
    trades.forEach(trade => {
      tradeMarkers.push({
        time: trade.entryTime,
        position: trade.type === 'long' ? 'belowBar' : 'aboveBar',
        color: trade.type === 'long' ? '#22c55e' : '#ef4444',
        shape: trade.type === 'long' ? 'arrowUp' : 'arrowDown',
        text: trade.type === 'long' ? 'BUY' : 'SELL',
        size: 1,
      });
      
      tradeMarkers.push({
        time: trade.exitTime,
        position: 'inBar',
        color: '#facc15',
        shape: 'circle',
        text: trade.pnl >= 0 ? `+$${trade.pnl.toFixed(0)}` : `-$${Math.abs(trade.pnl).toFixed(0)}`,
        size: 1,
      });
    });
    
    tradeMarkers.sort((a, b) => a.time - b.time);
    
    try {
      createSeriesMarkers(tradeCandleSeries, tradeMarkers);
    } catch (e) {
      console.warn('Trade markers error:', e.message);
    }
  }
  
  tradeChart.timeScale().fitContent();
  
  new ResizeObserver(() => {
    if (tradeChart) {
      tradeChart.applyOptions({ width: container.clientWidth });
    }
  }).observe(container);
}
