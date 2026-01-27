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
let pendingResearchAnswers = null;
let pendingResearchQuestions = null;
let pendingOriginalDescription = null;

const FALLBACK_DATA = {
  silver: generateCandleData(65, 100, 0.02),
  gold: generateCandleData(2900, 100, 0.01),
  copper: generateCandleData(4.5, 100, 0.025),
  oil: generateCandleData(59.44, 100, 0.03),
  natgas: generateCandleData(3.47, 100, 0.04),
  eurusd: generateCandleData(1.1673, 100, 0.005),
  gbpusd: generateCandleData(1.344, 100, 0.006),
  usdjpy: generateCandleData(159.06, 100, 0.004),
  spx500: generateCandleData(6947, 100, 0.012),
  dax: generateCandleData(24921, 100, 0.015),
  ftse: generateCandleData(10141, 100, 0.01)
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

async function loadSavedStrategies() {
  try {
    const response = await fetch('/api/strategies');
    const data = await response.json();
    const strategies = data.strategies || [];
    
    const select = document.getElementById('strategyType');
    if (!select) return;
    
    const customOption = select.querySelector('option[value="custom"]');
    
    strategies.forEach(strategy => {
      const existingOption = select.querySelector(`option[value="saved_${strategy.id}"]`);
      if (existingOption) return;
      
      const option = document.createElement('option');
      option.value = `saved_${strategy.id}`;
      option.textContent = strategy.name;
      option.dataset.strategyId = strategy.id;
      option.dataset.description = strategy.description;
      option.dataset.keyPoints = strategy.keyPoints;
      option.dataset.codeTemplate = strategy.codeTemplate;
      
      if (customOption) {
        select.insertBefore(option, customOption);
      } else {
        select.appendChild(option);
      }
    });
    
    select.addEventListener('change', (e) => {
      const selectedOption = e.target.selectedOptions[0];
      if (selectedOption && selectedOption.value.startsWith('saved_')) {
        const extraInstructions = document.getElementById('botExtraInstructions');
        if (extraInstructions) {
          const parts = [];
          if (selectedOption.dataset.description) parts.push(selectedOption.dataset.description);
          if (selectedOption.dataset.keyPoints) parts.push(selectedOption.dataset.keyPoints);
          if (selectedOption.dataset.codeTemplate) parts.push(`Code Template:\n${selectedOption.dataset.codeTemplate}`);
          extraInstructions.value = parts.join('\n\n');
        }
      }
    });
  } catch (e) {
    console.warn('Failed to load saved strategies:', e);
  }
}

export async function initBotBuilder() {
  if (initialized && chart) {
    return;
  }
  
  const container = document.getElementById('chartContainer');
  if (!container) return;
  
  await loadSavedStrategies();

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
  
  // Summary Preview Modal
  const previewSummaryBtn = document.getElementById('previewSummaryBtn');
  const summaryModal = document.getElementById('summaryPreviewModal');
  const closeSummaryModal = document.getElementById('closeSummaryModal');
  const closeSummaryBtn = document.getElementById('closeSummaryBtn');
  const generateFromSummaryBtn = document.getElementById('generateFromSummaryBtn');
  const summaryContent = document.getElementById('summaryPreviewContent');
  
  function showSummaryPreview() {
    const settings = getSettings();
    const html = buildSummaryHTML(settings);
    if (summaryContent) summaryContent.innerHTML = html;
    if (summaryModal) {
      summaryModal.style.display = 'flex';
      summaryModal.classList.remove('hidden');
    }
  }
  
  function hideSummaryModal() {
    if (summaryModal) {
      summaryModal.style.display = 'none';
      summaryModal.classList.add('hidden');
    }
  }
  
  if (previewSummaryBtn) previewSummaryBtn.addEventListener('click', showSummaryPreview);
  if (closeSummaryModal) closeSummaryModal.addEventListener('click', hideSummaryModal);
  if (closeSummaryBtn) closeSummaryBtn.addEventListener('click', hideSummaryModal);
  if (generateFromSummaryBtn) generateFromSummaryBtn.addEventListener('click', () => {
    hideSummaryModal();
    generateBot();
  });
  if (summaryModal) {
    summaryModal.addEventListener('click', (e) => {
      if (e.target === summaryModal) hideSummaryModal();
    });
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

  const strategyTypeSelect = document.getElementById('strategyType');
  const baseCodeInputContainer = document.getElementById('baseCodeInputContainer');
  const strategyCodePreview = document.getElementById('strategyCodePreview');
  const strategyCodePreviewContent = document.getElementById('strategyCodePreviewContent');
  
  if (strategyTypeSelect && baseCodeInputContainer) {
    strategyTypeSelect.addEventListener('change', () => {
      const selectedOption = strategyTypeSelect.selectedOptions[0];
      
      if (strategyTypeSelect.value === 'paste') {
        baseCodeInputContainer.classList.remove('hidden');
        if (strategyCodePreview) strategyCodePreview.classList.add('hidden');
      } else {
        baseCodeInputContainer.classList.add('hidden');
        
        // Show code preview for saved strategies
        if (selectedOption && selectedOption.value.startsWith('saved_') && selectedOption.dataset.codeTemplate) {
          if (strategyCodePreview && strategyCodePreviewContent) {
            strategyCodePreviewContent.textContent = selectedOption.dataset.codeTemplate;
            strategyCodePreview.classList.remove('hidden');
          }
        } else {
          if (strategyCodePreview) strategyCodePreview.classList.add('hidden');
        }
      }
    });
  }

  // AI Research Q&A handlers
  setupResearchQA();

  const enableTimeFilters = document.getElementById('enableTimeFilters');
  const timeFiltersContent = document.getElementById('timeFiltersContent');
  if (enableTimeFilters && timeFiltersContent) {
    const syncTimeFiltersState = () => {
      if (enableTimeFilters.checked) {
        timeFiltersContent.classList.remove('opacity-50', 'pointer-events-none');
      } else {
        timeFiltersContent.classList.add('opacity-50', 'pointer-events-none');
      }
    };
    syncTimeFiltersState();
    enableTimeFilters.addEventListener('change', syncTimeFiltersState);
  }

  setupStrategyIdeasModal();

  const chartContainer = document.getElementById('chartContainer');
  if (chartContainer) {
    chart.subscribeClick(handleChartClick);
  }
}

function setupResearchQA() {
  const qaContainer = document.getElementById('aiResearchQA');
  const questionsContent = document.getElementById('aiQuestionsContent');
  const answersInput = document.getElementById('userAnswersInput');
  const submitBtn = document.getElementById('submitAnswersBtn');
  const skipBtn = document.getElementById('skipQuestionsBtn');
  
  if (!submitBtn || !skipBtn) return;
  
  submitBtn.addEventListener('click', async () => {
    if (!answersInput?.value.trim()) {
      alert('Please provide answers to the questions');
      return;
    }
    
    pendingResearchAnswers = answersInput.value.trim();
    
    if (qaContainer) qaContainer.classList.add('hidden');
    if (answersInput) answersInput.value = '';
    
    await generateBot();
  });
  
  skipBtn.addEventListener('click', async () => {
    pendingResearchAnswers = null;
    pendingResearchQuestions = null;
    pendingOriginalDescription = null;
    
    if (qaContainer) qaContainer.classList.add('hidden');
    if (answersInput) answersInput.value = '';
    
    await generateBot();
  });
}

async function checkForResearchQuestions() {
  const strategyType = document.getElementById('strategyType')?.value;
  const baseCodeInput = document.getElementById('baseCodeInput')?.value?.trim();
  
  if (strategyType !== 'paste' || !baseCodeInput || baseCodeInput.length < 10) {
    return false;
  }
  
  const codeIndicators = ['defparam', 'if ', 'endif', 'buy ', 'sell ', 'set stop', 'set target', 'once ', 'longonmarket', 'shortonmarket'];
  const lowerCode = baseCodeInput.toLowerCase();
  const isLikelyCode = codeIndicators.some(ind => lowerCode.includes(ind));
  
  if (isLikelyCode) {
    return false;
  }
  
  const qaContainer = document.getElementById('aiResearchQA');
  const questionsContent = document.getElementById('aiQuestionsContent');
  
  try {
    const settings = getSettings();
    const response = await fetch('/api/research-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: baseCodeInput, settings })
    });
    
    const data = await response.json();
    
    if (data.hasQuestions && data.questions) {
      pendingResearchQuestions = data.questions;
      pendingOriginalDescription = baseCodeInput;
      
      if (questionsContent) {
        questionsContent.textContent = data.questions;
      }
      if (qaContainer) {
        qaContainer.classList.remove('hidden');
      }
      
      return true;
    }
  } catch (err) {
    console.warn('Research questions error:', err);
  }
  
  return false;
}

function setupStrategyIdeasModal() {
  const openBtn = document.getElementById('getStrategyIdeasBtn');
  const modal = document.getElementById('strategyIdeasModalGlobal');
  const closeBtn = document.getElementById('closeStrategyModalGlobal');
  const searchBtn = document.getElementById('searchStrategiesBtnGlobal');
  const searchInput = document.getElementById('strategySearchInputGlobal');
  const resultsContainer = document.getElementById('strategyResultsGlobal');
  const loadingEl = document.getElementById('strategyLoadingGlobal');
  const categoryChips = document.querySelectorAll('.strategy-chip');
  const searchTab = document.getElementById('ideasSearchTab');
  const historyTab = document.getElementById('ideasHistoryTab');
  const searchPanel = document.getElementById('ideasSearchPanel');
  const historyPanel = document.getElementById('ideasHistoryPanel');
  const historyList = document.getElementById('searchHistoryList');
  
  let currentSearchResults = [];
  let currentSearchQuery = '';
  
  function showModal() {
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.remove('hidden');
    }
  }
  
  function hideModal() {
    if (modal) {
      modal.style.display = 'none';
      modal.classList.add('hidden');
    }
  }
  
  function switchToTab(tab) {
    if (tab === 'search') {
      searchTab.classList.add('text-amber-600', 'dark:text-amber-400', 'border-amber-500', 'bg-amber-50', 'dark:bg-amber-900/20');
      searchTab.classList.remove('text-gray-500', 'dark:text-gray-400', 'border-transparent');
      historyTab.classList.remove('text-amber-600', 'dark:text-amber-400', 'border-amber-500', 'bg-amber-50', 'dark:bg-amber-900/20');
      historyTab.classList.add('text-gray-500', 'dark:text-gray-400', 'border-transparent');
      searchPanel.classList.remove('hidden');
      historyPanel.classList.add('hidden');
    } else {
      historyTab.classList.add('text-amber-600', 'dark:text-amber-400', 'border-amber-500', 'bg-amber-50', 'dark:bg-amber-900/20');
      historyTab.classList.remove('text-gray-500', 'dark:text-gray-400', 'border-transparent');
      searchTab.classList.remove('text-amber-600', 'dark:text-amber-400', 'border-amber-500', 'bg-amber-50', 'dark:bg-amber-900/20');
      searchTab.classList.add('text-gray-500', 'dark:text-gray-400', 'border-transparent');
      historyPanel.classList.remove('hidden');
      searchPanel.classList.add('hidden');
      loadSearchHistory();
    }
  }
  
  if (searchTab) searchTab.addEventListener('click', () => switchToTab('search'));
  if (historyTab) historyTab.addEventListener('click', () => switchToTab('history'));
  
  async function loadSearchHistory() {
    try {
      const response = await fetch('/api/search-history');
      const data = await response.json();
      displaySearchHistory(data.history || []);
    } catch (e) {
      console.error('Failed to load search history:', e);
    }
  }
  
  function displaySearchHistory(history) {
    if (history.length === 0) {
      historyList.innerHTML = `
        <div class="text-center py-12 text-gray-500 dark:text-gray-400">
          <svg class="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p class="text-lg font-medium mb-2">No search history yet</p>
          <p class="text-sm">Your searches will appear here</p>
        </div>
      `;
      return;
    }
    
    // Store history data in memory instead of DOM to avoid JSON corruption
    const historyDataMap = new Map();
    history.forEach(entry => historyDataMap.set(entry.id, entry.results));
    
    historyList.innerHTML = history.map(entry => {
      const date = new Date(entry.createdAt).toLocaleDateString();
      const time = new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="history-entry border border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden">
          <div class="p-4 bg-gray-50 dark:bg-gray-700/50 flex items-center justify-between cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700" data-history-id="${entry.id}">
            <div class="flex items-center gap-3">
              <svg class="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
              <div>
                <p class="font-medium text-gray-900 dark:text-white">${entry.query || entry.category || 'Search'}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">${date} ${time} - ${entry.results.length} results</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button class="delete-history-btn text-gray-400 hover:text-red-500 p-1" data-history-id="${entry.id}" title="Delete">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                </svg>
              </button>
              <svg class="w-5 h-5 text-gray-400 expand-icon transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
              </svg>
            </div>
          </div>
          <div class="history-results hidden p-4 space-y-3 max-h-96 overflow-y-auto" data-history-id="${entry.id}">
          </div>
        </div>
      `;
    }).join('');
    
    historyList.querySelectorAll('.history-entry > div:first-child').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.delete-history-btn')) return;
        const resultsDiv = header.nextElementSibling;
        const icon = header.querySelector('.expand-icon');
        const historyId = resultsDiv.dataset.historyId;
        if (resultsDiv.classList.contains('hidden')) {
          resultsDiv.classList.remove('hidden');
          icon.classList.add('rotate-180');
          const results = historyDataMap.get(historyId) || [];
          renderHistoryResults(resultsDiv, results);
        } else {
          resultsDiv.classList.add('hidden');
          icon.classList.remove('rotate-180');
        }
      });
    });
    
    historyList.querySelectorAll('.delete-history-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.historyId;
        try {
          await fetch(`/api/search-history/${id}`, { method: 'DELETE' });
          loadSearchHistory();
        } catch (err) {
          console.error('Failed to delete history:', err);
        }
      });
    });
  }
  
  function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  
  function renderHistoryResults(container, results) {
    container.innerHTML = results.map((r, i) => `
      <div class="p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700">
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <h4 class="font-medium text-sm text-gray-900 dark:text-white truncate">${escapeHtml(r.title)}</h4>
            <p class="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">${escapeHtml(r.description)}</p>
            ${r.url ? `<a href="${r.url}" target="_blank" class="text-xs text-green-600 dark:text-green-400 hover:underline">View on ProRealCode</a>` : ''}
          </div>
          <div class="flex gap-1 shrink-0">
            <button class="history-add-btn px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded transition-colors" data-idx="${i}">Add</button>
            <button class="history-use-btn px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium rounded transition-colors" data-idx="${i}">Use</button>
          </div>
        </div>
        ${r.codeSnippet ? `
          <details class="mt-2">
            <summary class="text-xs text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-200">Show code (${r.codeSnippet.length} chars)</summary>
            <pre class="mt-1 p-2 bg-gray-900 text-gray-100 rounded text-xs font-mono overflow-x-auto max-h-48 whitespace-pre-wrap">${escapeHtml(r.codeSnippet)}</pre>
          </details>
        ` : '<p class="text-xs text-gray-400 mt-1 italic">No code found</p>'}
      </div>
    `).join('');
    
    container.querySelectorAll('.history-use-btn').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        applyStrategyIdea(results[idx]);
        hideModal();
      });
    });
    
    container.querySelectorAll('.history-add-btn').forEach((btn, idx) => {
      btn.addEventListener('click', async () => {
        await saveStrategyToDropdown(results[idx]);
      });
    });
  }
  
  if (openBtn) {
    openBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showModal();
    });
  }
  
  if (closeBtn) {
    closeBtn.addEventListener('click', hideModal);
  }
  
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        hideModal();
      }
    });
  }
  
  async function searchStrategies(query) {
    if (!query.trim()) return;
    
    currentSearchQuery = query;
    resultsContainer.classList.add('hidden');
    loadingEl.classList.remove('hidden');
    
    try {
      const response = await fetch('/api/search-strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      
      const data = await response.json();
      currentSearchResults = data.results || [];
      displayStrategyResults(currentSearchResults);
      
      if (currentSearchResults.length > 0) {
        fetch('/api/search-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, results: currentSearchResults })
        }).catch(e => console.warn('Failed to save search history:', e));
      }
    } catch (e) {
      console.error('Strategy search failed:', e);
      resultsContainer.innerHTML = '<p class="text-center text-red-500 py-8">Search failed. Please try again.</p>';
      resultsContainer.classList.remove('hidden');
    } finally {
      loadingEl.classList.add('hidden');
    }
  }
  
  function displayStrategyResults(results) {
    if (results.length === 0) {
      resultsContainer.innerHTML = '<p class="text-center text-gray-500 dark:text-gray-400 py-8">No strategies found. Try a different search term.</p>';
      resultsContainer.classList.remove('hidden');
      return;
    }
    
    resultsContainer.innerHTML = results.map((r, i) => `
      <div class="strategy-result p-4 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:shadow-lg transition-shadow">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1">
            <h4 class="font-semibold text-gray-900 dark:text-white mb-1">${r.title}</h4>
            <p class="text-sm text-gray-600 dark:text-gray-300 mb-2">${r.description}</p>
            ${r.url ? `<a href="${r.url}" target="_blank" class="text-xs text-green-600 dark:text-green-400 hover:underline flex items-center gap-1">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
              </svg>
              View on ProRealCode
            </a>` : r.searchUrl ? `<a href="${r.searchUrl}" target="_blank" class="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
              Search ProRealCode
            </a>` : ''}
          </div>
          <div class="flex gap-2">
            <button class="add-strategy-btn px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap flex items-center gap-1" data-strategy-index="${i}" title="Add to dropdown menu">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
              Add
            </button>
            <button class="use-strategy-btn px-3 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap" data-strategy-index="${i}">
              Use
            </button>
          </div>
        </div>
        ${r.codeSnippet ? `
          <details class="mt-3">
            <summary class="text-xs text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-200">Show code preview</summary>
            <pre class="mt-2 p-3 bg-gray-900 text-gray-100 rounded-lg text-xs font-mono overflow-x-auto max-h-40">${r.codeSnippet}</pre>
          </details>
        ` : ''}
      </div>
    `).join('');
    
    resultsContainer.querySelectorAll('.use-strategy-btn').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        const result = results[idx];
        applyStrategyIdea(result);
        hideModal();
      });
    });
    
    resultsContainer.querySelectorAll('.add-strategy-btn').forEach((btn, idx) => {
      btn.addEventListener('click', async () => {
        const result = results[idx];
        await saveStrategyToDropdown(result);
      });
    });
    
    resultsContainer.classList.remove('hidden');
  }
  
  async function saveStrategyToDropdown(strategy) {
    try {
      const response = await fetch('/api/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: strategy.title,
          description: strategy.description,
          keyPoints: strategy.keyPoints || '',
          codeTemplate: strategy.codeSnippet || '',
          url: strategy.url || ''
        })
      });
      
      if (!response.ok) throw new Error('Failed to save strategy');
      
      const data = await response.json();
      addStrategyToDropdown(data.strategy);
      alert(`Strategy "${strategy.title}" added to dropdown!`);
    } catch (e) {
      console.error('Failed to save strategy:', e);
      alert('Failed to save strategy. Please try again.');
    }
  }
  
  function addStrategyToDropdown(strategy) {
    const select = document.getElementById('strategyType');
    if (!select) return;
    
    const existingOption = select.querySelector(`option[value="saved_${strategy.id}"]`);
    if (existingOption) return;
    
    const customOption = select.querySelector('option[value="custom"]');
    const option = document.createElement('option');
    option.value = `saved_${strategy.id}`;
    option.textContent = strategy.name;
    option.dataset.strategyId = strategy.id;
    option.dataset.description = strategy.description || '';
    option.dataset.keyPoints = strategy.keyPoints || '';
    option.dataset.codeTemplate = strategy.codeTemplate || '';
    
    if (customOption) {
      select.insertBefore(option, customOption);
    } else {
      select.appendChild(option);
    }
  }
  
  function applyStrategyIdea(strategy) {
    const strategySelect = document.getElementById('strategyType');
    if (strategySelect) {
      strategySelect.value = 'custom';
    }
    
    const extraInstructions = document.getElementById('botExtraInstructions');
    if (extraInstructions) {
      extraInstructions.value = `Strategy: ${strategy.title}\n\n${strategy.description}\n\n${strategy.keyPoints || ''}`;
    }
    
    alert(`Strategy "${strategy.title}" applied! The AI will use this as the base for code generation.`);
  }
  
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      searchStrategies(searchInput?.value || '');
    });
  }
  
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        searchStrategies(searchInput.value);
      }
    });
  }
  
  categoryChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const category = chip.dataset.cat || chip.dataset.category;
      if (searchInput) searchInput.value = category;
      searchStrategies(category);
    });
  });
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
  const enableTimeFilters = document.getElementById('enableTimeFilters')?.checked ?? true;
  const strategySelect = document.getElementById('strategyType');
  const strategyType = strategySelect?.value || '13thwarrior';
  const selectedOption = strategySelect?.selectedOptions?.[0];
  
  // Get base code from either pasted textarea OR saved strategy template
  let baseCode = '';
  if (strategyType === 'paste') {
    baseCode = document.getElementById('baseCodeInput')?.value || '';
  } else if (strategyType.startsWith('saved_') && selectedOption?.dataset?.codeTemplate) {
    baseCode = selectedOption.dataset.codeTemplate;
  }
  
  return {
    botName: document.getElementById('botName')?.value || '',
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
    useTrailingStop: document.getElementById('useTrailingStop')?.checked ?? true,
    trailingPercent: parseFloat(document.getElementById('trailingPercent')?.value) || 0.46,
    stepPercent: parseFloat(document.getElementById('stepPercent')?.value) || 0.018,
    useOBV: document.getElementById('useOBV')?.checked ?? true,
    obvPeriod: parseInt(document.getElementById('obvPeriod')?.value) || 5,
    useHeikinAshi: document.getElementById('useHeikinAshi')?.checked ?? true,
    strategyType: strategyType,
    baseCode: baseCode,
    extraInstructions: document.getElementById('botExtraInstructions')?.value || '',
    drawings: drawings,
    enableTimeFilters: enableTimeFilters,
    timezone: document.getElementById('timezone')?.value || 'Australia/Brisbane',
    excludeWeekends: enableTimeFilters && (document.getElementById('excludeWeekends')?.checked ?? true),
    excludeHolidays: enableTimeFilters && (document.getElementById('excludeHolidays')?.checked ?? true),
    useTimeFilter: enableTimeFilters && (document.getElementById('useTimeFilter')?.checked ?? true),
    tradingStartTime: document.getElementById('tradingStartTime')?.value || '09:00',
    tradingEndTime: document.getElementById('tradingEndTime')?.value || '17:00',
    excludeOpenPeriod: enableTimeFilters && (document.getElementById('excludeOpenPeriod')?.checked ?? true),
    openPeriodMinutes: parseInt(document.getElementById('openPeriodMinutes')?.value) || 30,
    excludeClosePeriod: enableTimeFilters && (document.getElementById('excludeClosePeriod')?.checked ?? true),
    closePeriodMinutes: parseInt(document.getElementById('closePeriodMinutes')?.value) || 30,
    closeBeforeEnd: enableTimeFilters && (document.getElementById('closeBeforeEnd')?.checked || false),
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
  
  desc += `STRATEGY: ${settings.strategyType}\n`;
  if (settings.baseCode) {
    desc += `\nBASE CODE TO MODIFY/IMPROVE:\n\`\`\`\n${settings.baseCode}\n\`\`\`\n`;
    desc += `IMPORTANT: Use this code as a starting point. Apply the settings, risk management, and time filters specified above to modify/improve this base code. Keep the core strategy logic intact unless the extra instructions request changes.\n\n`;
  } else {
    desc += `\n`;
  }
  
  if (!settings.enableTimeFilters) {
    desc += `TIME & SESSION FILTERS: DISABLED (no time-based restrictions)\n\n`;
  } else {
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
  }
  
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

function buildSummaryHTML(settings) {
  const sections = [];
  
  // Bot Name (if set)
  if (settings.botName) {
    sections.push(`
      <div class="bg-gradient-to-r from-indigo-500 to-purple-500 rounded-lg p-3 text-white">
        <h4 class="font-bold text-lg">${settings.botName}</h4>
      </div>
    `);
  }
  
  // Asset & Timeframe
  sections.push(`
    <div class="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-200 dark:border-blue-700">
      <h4 class="font-semibold text-blue-700 dark:text-blue-300 mb-2 flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"/></svg>
        Asset & Timeframe
      </h4>
      <div class="grid grid-cols-2 gap-2 text-sm">
        <div><span class="text-gray-500 dark:text-gray-400">Asset:</span> <span class="font-medium text-gray-900 dark:text-white">${settings.asset.toUpperCase()}</span></div>
        <div><span class="text-gray-500 dark:text-gray-400">Timeframe:</span> <span class="font-medium text-gray-900 dark:text-white">${settings.timeframe}</span></div>
      </div>
    </div>
  `);
  
  // Fee Settings
  sections.push(`
    <div class="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-3 border border-gray-200 dark:border-gray-600">
      <h4 class="font-semibold text-gray-700 dark:text-gray-300 mb-2">Fee Settings</h4>
      <div class="grid grid-cols-2 gap-2 text-sm">
        <div><span class="text-gray-500 dark:text-gray-400">Initial Capital:</span> <span class="font-medium">$${settings.initialCapital}</span></div>
        <div><span class="text-gray-500 dark:text-gray-400">Max Position:</span> <span class="font-medium">${settings.maxPositionSize}</span></div>
        ${settings.useOrderFee ? `<div><span class="text-gray-500 dark:text-gray-400">Order Fee:</span> <span class="font-medium">$${settings.orderFee}</span></div>` : ''}
        ${settings.useSpread ? `<div><span class="text-gray-500 dark:text-gray-400">Spread:</span> <span class="font-medium">${settings.spreadPips} pips</span></div>` : ''}
      </div>
    </div>
  `);
  
  // Position Settings
  sections.push(`
    <div class="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 border border-green-200 dark:border-green-700">
      <h4 class="font-semibold text-green-700 dark:text-green-300 mb-2">Position Settings</h4>
      <div class="grid grid-cols-3 gap-2 text-sm">
        <div><span class="text-gray-500 dark:text-gray-400">Size:</span> <span class="font-medium">${settings.positionSize}</span></div>
        <div><span class="text-gray-500 dark:text-gray-400">Type:</span> <span class="font-medium">${settings.tradeType === 'both' ? 'Long & Short' : settings.tradeType}</span></div>
        <div><span class="text-gray-500 dark:text-gray-400">Cumulate:</span> <span class="font-medium">${settings.cumulateOrders ? 'Yes' : 'No'}</span></div>
      </div>
    </div>
  `);
  
  // Risk Management
  sections.push(`
    <div class="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 border border-red-200 dark:border-red-700">
      <h4 class="font-semibold text-red-700 dark:text-red-300 mb-2">Risk Management</h4>
      <div class="grid grid-cols-2 gap-2 text-sm">
        <div><span class="text-gray-500 dark:text-gray-400">Stop Loss:</span> <span class="font-medium">${settings.stopLoss} pts</span></div>
        <div><span class="text-gray-500 dark:text-gray-400">Take Profit:</span> <span class="font-medium">${settings.takeProfit} pts</span></div>
        ${settings.useTrailingStop ? `<div class="col-span-2"><span class="text-gray-500 dark:text-gray-400">Trailing Stop:</span> <span class="font-medium">${settings.trailingPercent}% trigger, ${settings.stepPercent}% step</span></div>` : ''}
      </div>
    </div>
  `);
  
  // Indicators
  const indicators = [];
  if (settings.useOBV) indicators.push(`OBV (${settings.obvPeriod})`);
  if (settings.useHeikinAshi) indicators.push('Heikin Ashi');
  if (indicators.length > 0) {
    sections.push(`
      <div class="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 border border-purple-200 dark:border-purple-700">
        <h4 class="font-semibold text-purple-700 dark:text-purple-300 mb-2">Indicators</h4>
        <div class="text-sm font-medium">${indicators.join(', ')}</div>
      </div>
    `);
  }
  
  // Strategy & Base Code
  let strategyName = settings.strategyType;
  if (strategyName.startsWith('saved_')) strategyName = strategyName.replace('saved_', '').replace(/_/g, ' ');
  sections.push(`
    <div class="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 border border-amber-200 dark:border-amber-700">
      <h4 class="font-semibold text-amber-700 dark:text-amber-300 mb-2">Strategy</h4>
      <div class="text-sm font-medium mb-2">${strategyName}</div>
      ${settings.baseCode ? `
        <details class="mt-2">
          <summary class="text-xs text-amber-600 dark:text-amber-400 cursor-pointer">View Base Code (${settings.baseCode.length} chars)</summary>
          <pre class="mt-1 p-2 bg-gray-900 text-gray-100 rounded text-xs font-mono overflow-x-auto max-h-32 whitespace-pre-wrap">${settings.baseCode.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
        </details>
      ` : '<div class="text-xs text-gray-500 dark:text-gray-400">No base code - will generate from scratch</div>'}
    </div>
  `);
  
  // Time Filters
  if (settings.enableTimeFilters) {
    const tradeDays = Object.entries(settings.tradeDays).filter(([,v]) => v).map(([k]) => k.charAt(0).toUpperCase() + k.slice(1)).join(', ');
    sections.push(`
      <div class="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-3 border border-indigo-200 dark:border-indigo-700">
        <h4 class="font-semibold text-indigo-700 dark:text-indigo-300 mb-2">Time & Session Filters</h4>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div><span class="text-gray-500 dark:text-gray-400">Timezone:</span> <span class="font-medium">${settings.timezone}</span></div>
          <div><span class="text-gray-500 dark:text-gray-400">Days:</span> <span class="font-medium">${tradeDays}</span></div>
          ${settings.useTimeFilter ? `<div class="col-span-2"><span class="text-gray-500 dark:text-gray-400">Hours:</span> <span class="font-medium">${settings.tradingStartTime} - ${settings.tradingEndTime}</span></div>` : ''}
          ${settings.excludeWeekends ? `<div><span class="text-green-600">✓</span> Exclude weekends</div>` : ''}
          ${settings.excludeHolidays ? `<div><span class="text-green-600">✓</span> Exclude holidays</div>` : ''}
          ${settings.excludeOpenPeriod ? `<div><span class="text-green-600">✓</span> Skip first ${settings.openPeriodMinutes}min</div>` : ''}
          ${settings.excludeClosePeriod ? `<div><span class="text-green-600">✓</span> Skip last ${settings.closePeriodMinutes}min</div>` : ''}
          ${settings.closeBeforeEnd ? `<div><span class="text-green-600">✓</span> Force close ${settings.closeBeforeMinutes}min before end</div>` : ''}
        </div>
      </div>
    `);
  } else {
    sections.push(`
      <div class="bg-gray-100 dark:bg-gray-700/30 rounded-lg p-3 border border-gray-300 dark:border-gray-600">
        <h4 class="font-semibold text-gray-500 dark:text-gray-400 mb-1">Time & Session Filters</h4>
        <div class="text-sm text-gray-500">Disabled - no time restrictions</div>
      </div>
    `);
  }
  
  // Chart Annotations
  if (settings.drawings.length > 0) {
    sections.push(`
      <div class="bg-cyan-50 dark:bg-cyan-900/20 rounded-lg p-3 border border-cyan-200 dark:border-cyan-700">
        <h4 class="font-semibold text-cyan-700 dark:text-cyan-300 mb-2">Chart Annotations (${settings.drawings.length})</h4>
        <ul class="text-sm space-y-1">
          ${settings.drawings.map(d => {
            if (d.type === 'high') return `<li>• High point at ${d.point.high.toFixed(4)}</li>`;
            if (d.type === 'low') return `<li>• Low point at ${d.point.low.toFixed(4)}</li>`;
            if (d.type === 'horizontal') return `<li>• Horizontal level at ${d.price.toFixed(4)}</li>`;
            if (d.type === 'line') return `<li>• Trend line: ${d.start.price.toFixed(4)} → ${d.end.price.toFixed(4)}</li>`;
            return '';
          }).join('')}
        </ul>
      </div>
    `);
  }
  
  // Extra Instructions
  if (settings.extraInstructions) {
    sections.push(`
      <div class="bg-pink-50 dark:bg-pink-900/20 rounded-lg p-3 border border-pink-200 dark:border-pink-700">
        <h4 class="font-semibold text-pink-700 dark:text-pink-300 mb-2">Additional Instructions</h4>
        <div class="text-sm whitespace-pre-wrap">${settings.extraInstructions}</div>
      </div>
    `);
  }
  
  return sections.join('');
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
  const strategyTypeEl = document.getElementById('strategyType');
  const baseCodeInput = document.getElementById('baseCodeInput')?.value?.trim();
  
  // Check if we should ask research questions first (only for custom descriptions, not code)
  if (strategyTypeEl?.value === 'paste' && baseCodeInput && !pendingResearchQuestions && !pendingResearchAnswers) {
    const hasQuestions = await checkForResearchQuestions();
    if (hasQuestions) {
      return;
    }
  }
  
  let description = buildBotDescription(settings);
  
  // Append Q&A context if we have research answers (include original description)
  if (pendingResearchQuestions && pendingResearchAnswers && pendingOriginalDescription) {
    description += `\n\n--- USER'S ORIGINAL STRATEGY REQUEST ---\n${pendingOriginalDescription}\n\n--- AI RESEARCH Q&A ---\nQuestions asked:\n${pendingResearchQuestions}\n\nUser's answers:\n${pendingResearchAnswers}`;
    
    pendingResearchQuestions = null;
    pendingResearchAnswers = null;
    pendingOriginalDescription = null;
  }
  
  const generateBotBtn = document.getElementById('generateBotBtn');
  const botOutputSection = document.getElementById('botOutputSection');
  const botCodeOutput = document.getElementById('botCodeOutput');
  const assetSelect = document.getElementById('assetSelect');
  const strategyType = strategyTypeEl;
  
  // Progress bar elements
  const progressContainer = document.getElementById('generateProgress');
  const progressBar = document.getElementById('generateProgressBar');
  const progressText = document.getElementById('generateProgressText');
  const progressPercent = document.getElementById('generateProgressPercent');
  
  generateBotBtn.disabled = true;
  generateBotBtn.classList.add('hidden');
  
  // Show and animate progress bar
  if (progressContainer) {
    progressContainer.classList.remove('hidden');
    let progress = 0;
    const progressSteps = [
      { pct: 10, text: 'Preparing request...' },
      { pct: 25, text: 'Sending to AI...' },
      { pct: 40, text: 'AI processing settings...' },
      { pct: 55, text: 'Generating bot logic...' },
      { pct: 70, text: 'Writing ProRealTime code...' },
      { pct: 85, text: 'Finalizing code...' }
    ];
    let stepIndex = 0;
    
    const progressInterval = setInterval(() => {
      if (stepIndex < progressSteps.length) {
        progress = progressSteps[stepIndex].pct;
        if (progressBar) progressBar.style.width = progress + '%';
        if (progressText) progressText.textContent = progressSteps[stepIndex].text;
        if (progressPercent) progressPercent.textContent = progress + '%';
        stepIndex++;
      }
    }, 800);
    
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
          strategy: strategyType?.value || 'custom',
          botName: settings.botName
        })
      });

      clearInterval(progressInterval);
      
      // Complete progress
      if (progressBar) progressBar.style.width = '100%';
      if (progressText) progressText.textContent = 'Complete!';
      if (progressPercent) progressPercent.textContent = '100%';

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
      clearInterval(progressInterval);
      alert('Error generating bot: ' + err.message);
    } finally {
      // Hide progress and show button again
      setTimeout(() => {
        if (progressContainer) progressContainer.classList.add('hidden');
        if (progressBar) progressBar.style.width = '0%';
        generateBotBtn.disabled = false;
        generateBotBtn.classList.remove('hidden');
      }, 500);
    }
  } else {
    // Fallback if no progress bar
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
          strategy: strategyType?.value || 'custom',
          botName: settings.botName
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
      const displayName = entry.botName || `${assetLabel} - ${strategyLabel}`;
      
      return `
        <div class="history-item group p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-600" data-id="${entry.id}">
          <div class="flex items-center justify-between">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">${displayName}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">${assetLabel} - ${date}</p>
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
    if (data.botName) {
      const botNameInput = document.getElementById('botName');
      if (botNameInput) botNameInput.value = data.botName;
    }
    
    if (data.variableOverrides && data.variableOverrides.length > 0) {
      detectedVariables = data.variableOverrides;
      const modifiedCode = applyVariablesToCode(generatedBotCode, detectedVariables);
      if (botCodeOutput) botCodeOutput.textContent = modifiedCode;
      showCodeVariableSlidersFromData(detectedVariables);
    } else {
      if (botCodeOutput) botCodeOutput.textContent = data.code;
      detectedVariables = [];
      detectAndDisplayVariables();
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
  const aiTradingTabBtn = document.getElementById('botAiTradingTabBtn');
  const settingsContent = document.getElementById('botSettingsTabContent');
  const simulatorContent = document.getElementById('botSimulatorTabContent');
  const aiTradingContent = document.getElementById('botAiTradingTabContent');
  
  const activeClass = 'bot-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300';
  const inactiveClass = 'bot-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700';
  const aiActiveClass = 'bot-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5';
  const aiInactiveClass = 'bot-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1.5';
  
  function switchToTab(tab) {
    settingsTabBtn.className = tab === 'settings' ? activeClass : inactiveClass;
    simulatorTabBtn.className = tab === 'simulator' ? activeClass : inactiveClass;
    if (aiTradingTabBtn) aiTradingTabBtn.className = tab === 'aiTrading' ? aiActiveClass : aiInactiveClass;
    
    if (settingsContent) settingsContent.classList.toggle('hidden', tab !== 'settings');
    if (simulatorContent) simulatorContent.classList.toggle('hidden', tab !== 'simulator');
    if (aiTradingContent) aiTradingContent.classList.toggle('hidden', tab !== 'aiTrading');
  }
  
  if (settingsTabBtn) {
    settingsTabBtn.addEventListener('click', () => switchToTab('settings'));
  }
  if (simulatorTabBtn) {
    simulatorTabBtn.addEventListener('click', () => switchToTab('simulator'));
  }
  if (aiTradingTabBtn) {
    aiTradingTabBtn.addEventListener('click', () => switchToTab('aiTrading'));
  }
  
  // AI Trading sub-tabs (AI Strategy / AI Results)
  setupAiTradingSubTabs();
}

function setupAiTradingSubTabs() {
  const strategySubTab = document.getElementById('aiStrategySubTab');
  const resultsSubTab = document.getElementById('aiResultsSubTab');
  const strategyContent = document.getElementById('aiStrategyContent');
  const resultsContent = document.getElementById('aiResultsContent');
  
  const activeClass = 'ai-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 flex items-center gap-1.5';
  const inactiveClass = 'ai-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1.5';
  
  if (strategySubTab) {
    strategySubTab.addEventListener('click', () => {
      strategySubTab.className = activeClass;
      if (resultsSubTab) resultsSubTab.className = inactiveClass;
      if (strategyContent) strategyContent.classList.remove('hidden');
      if (resultsContent) resultsContent.classList.add('hidden');
    });
  }
  
  if (resultsSubTab) {
    resultsSubTab.addEventListener('click', () => {
      resultsSubTab.className = activeClass;
      if (strategySubTab) strategySubTab.className = inactiveClass;
      if (strategyContent) strategyContent.classList.add('hidden');
      if (resultsContent) resultsContent.classList.remove('hidden');
    });
  }
  
  // Toggle PRT code panel
  const togglePrtBtn = document.getElementById('toggleAiPrtCode');
  const prtPanel = document.getElementById('aiPrtCodePanel');
  const prtChevron = document.getElementById('aiPrtChevron');
  
  if (togglePrtBtn && prtPanel) {
    togglePrtBtn.addEventListener('click', () => {
      prtPanel.classList.toggle('hidden');
      if (prtChevron) {
        prtChevron.classList.toggle('rotate-180');
      }
    });
  }
  
  // Run AI Analysis button
  const runAiBtn = document.getElementById('runAiAnalysis');
  if (runAiBtn) {
    runAiBtn.addEventListener('click', runAiStrategyAnalysis);
  }
}

// AI Strategy Analysis
async function runAiStrategyAnalysis() {
  const runBtn = document.getElementById('runAiAnalysis');
  const symbol = document.getElementById('aiSymbol')?.value || 'silver';
  const session = document.getElementById('aiSession')?.value || 'auto';
  const searchQuery = document.getElementById('aiStrategySearch')?.value || '';
  const candleCount = parseInt(document.getElementById('aiCandleCount')?.value || '100');
  
  // Show loading state
  if (runBtn) {
    runBtn.disabled = true;
    runBtn.innerHTML = `
      <svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      Analyzing...
    `;
  }
  
  try {
    // Fetch current market data for context
    const timeframe = '1h';
    const marketDataRes = await fetch(`/api/market-data/${symbol}/${timeframe}`);
    const marketData = await marketDataRes.json();
    
    if (!marketData.candles || marketData.candles.length === 0) {
      throw new Error('No market data available');
    }
    
    // Call AI strategy endpoint
    const candlesToSend = Math.min(candleCount, marketData.candles.length);
    const response = await fetch('/api/ai-strategy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        session,
        searchQuery,
        candles: marketData.candles.slice(-candlesToSend),
        currentPrice: marketData.candles[marketData.candles.length - 1].close,
        candleCount: candlesToSend
      })
    });
    
    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error);
    }
    
    // Update UI with results
    updateAiStrategyUI(result);
    
  } catch (error) {
    console.error('AI Strategy error:', error);
    alert('AI Analysis failed: ' + error.message);
  } finally {
    // Restore button
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
        </svg>
        Run AI
      `;
    }
  }
}

function updateAiStrategyUI(result) {
  // Update Market Context
  const contextSymbol = document.getElementById('aiContextSymbol');
  const contextSession = document.getElementById('aiContextSession');
  const contextVolatility = document.getElementById('aiContextVolatility');
  const contextRegime = document.getElementById('aiContextRegime');
  const contextStructure = document.getElementById('aiContextStructure');
  const contextConfidence = document.getElementById('aiContextConfidence');
  
  if (result.context) {
    if (contextSymbol) contextSymbol.textContent = result.context.symbol || 'N/A';
    if (contextSession) contextSession.textContent = result.context.session || 'N/A';
    if (contextVolatility) contextVolatility.textContent = result.context.volatility || 'Normal';
    if (contextRegime) contextRegime.textContent = result.context.regime || 'Unknown';
    if (contextStructure) contextStructure.textContent = result.context.structure || 'N/A';
    if (contextConfidence) {
      const conf = result.context.confidence || 3;
      contextConfidence.innerHTML = '●'.repeat(conf) + '○'.repeat(5 - conf);
    }
  }
  
  // Update Learning Feedback
  const learningSetups = document.getElementById('aiLearningSetups');
  const learningPerf = document.getElementById('aiLearningPerf');
  const learningAdapt = document.getElementById('aiLearningAdapt');
  
  if (result.learning) {
    if (learningSetups) learningSetups.textContent = result.learning.similarSetups || '0';
    if (learningPerf) learningPerf.textContent = result.learning.performance || 'N/A';
    if (learningAdapt) learningAdapt.textContent = result.learning.adaptation || 'N/A';
  }
  
  // Update Strategy Hypotheses
  const hypothesesContainer = document.getElementById('aiHypothesesContainer');
  if (hypothesesContainer && result.hypotheses && result.hypotheses.length > 0) {
    hypothesesContainer.innerHTML = result.hypotheses.map((h, i) => `
      <div class="bg-white dark:bg-gray-700/50 rounded-xl p-4 border border-purple-200 dark:border-purple-700/50">
        <div class="flex items-start justify-between mb-2">
          <h5 class="font-medium text-gray-800 dark:text-white flex items-center gap-2">
            <span class="w-2 h-2 bg-purple-500 rounded-full"></span>
            ${h.name || 'Strategy ' + (i + 1)}
          </h5>
          <span class="text-xs px-2 py-0.5 ${h.direction === 'Long' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : h.direction === 'Short' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' : 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300'} rounded">${h.direction || 'Neutral'} (${h.timeframe || 'M5'})</span>
        </div>
        <div class="flex flex-wrap gap-1.5 mb-3">
          ${(h.tags || []).map(tag => `<span class="px-2 py-0.5 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded">${tag}</span>`).join('')}
        </div>
        <div class="text-sm text-gray-600 dark:text-gray-400 mb-3">
          <p class="mb-1"><strong>Rationale:</strong></p>
          <ul class="list-disc list-inside text-xs space-y-0.5 ml-2">
            ${(h.rationale || []).map(r => `<li>${r}</li>`).join('')}
          </ul>
        </div>
        <div class="flex items-center justify-between">
          <div class="flex gap-2">
            <button onclick="addAiHypothesisToBot(${i})" class="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors">+ Add to Bot</button>
            <button onclick="useAiHypothesis(${i})" class="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded-lg transition-colors">Use</button>
          </div>
          <span class="text-xs text-gray-500">Confidence: ${h.confidence || 'Medium'}</span>
        </div>
      </div>
    `).join('');
    
    // Store hypotheses globally for button actions
    window.aiHypotheses = result.hypotheses;
  }
}

// Global functions for hypothesis buttons
window.addAiHypothesisToBot = function(index) {
  const h = window.aiHypotheses?.[index];
  if (!h) return;
  
  const extraInstructions = document.getElementById('botExtraInstructions');
  if (extraInstructions) {
    extraInstructions.value = (extraInstructions.value ? extraInstructions.value + '\n\n' : '') + 
      `AI Strategy: ${h.name}\nDirection: ${h.direction}\nTimeframe: ${h.timeframe}\nRationale: ${h.rationale?.join('; ')}`;
  }
  alert('Strategy added to Additional Instructions!');
};

window.useAiHypothesis = function(index) {
  const h = window.aiHypotheses?.[index];
  if (!h || !h.prtCode) {
    alert('No ProRealTime code available for this strategy');
    return;
  }
  
  // Copy to clipboard
  navigator.clipboard.writeText(h.prtCode).then(() => {
    alert('ProRealTime code copied to clipboard!');
  }).catch(() => {
    console.log('PRT Code:', h.prtCode);
    alert('Check console for ProRealTime code');
  });
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
    
    const datapoints = parseInt(document.getElementById('simDatapoints')?.value) || 2000;
    let candles = await fetchMarketData(asset, timeframe);
    if (candles.length > datapoints) {
      candles = candles.slice(-datapoints);
    }
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
  
  const excludeFromOptimizationPatterns = /^(preloadbars|preload|starttime|endtime|starthour|endhour|startminute|endminute|tradestarttime|tradeendtime|tradestarthour|tradeendhour|tradestartminute|tradeendminute|dayofweek|sessionstart|sessionend|openhour|closehour|openminute|closeminute|tradingstart|tradingend|marketopen|marketclose|sessionopen|sessionclose)$/i;
  
  detectedVariables.forEach(v => {
    v.includeInOptimization = !excludeFromOptimizationPatterns.test(v.name);
  });
  
  container.innerHTML = detectedVariables.map((v, i) => `
    <div class="flex items-center gap-3 bg-white dark:bg-gray-700 rounded-lg p-2 border border-gray-200 dark:border-gray-600">
      <input type="checkbox" 
        id="varOptCheck_${i}" 
        data-var-index="${i}"
        ${v.includeInOptimization ? 'checked' : ''}
        class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500"
        title="Include in auto-optimization">
      <span class="text-xs font-mono text-indigo-600 dark:text-indigo-400 w-20 truncate" title="${v.name}">${v.name}</span>
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
        class="w-16 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
      <span class="text-xs text-gray-400">(${v.originalValue})</span>
    </div>
  `).join('');
  
  detectedVariables.forEach((v, i) => {
    const slider = document.getElementById(`varSlider_${i}`);
    const input = document.getElementById(`varInput_${i}`);
    const checkbox = document.getElementById(`varOptCheck_${i}`);
    
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
    
    checkbox?.addEventListener('change', (e) => {
      detectedVariables[i].includeInOptimization = e.target.checked;
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
    const datapoints = parseInt(document.getElementById('simDatapoints')?.value) || 2000;
    let candles = await fetchMarketData(asset, timeframe);
    if (candles.length > datapoints) {
      candles = candles.slice(-datapoints);
    }
    currentCandles = candles;
    
    for (let i = 0; i < iterations; i++) {
      const testVars = detectedVariables.map(v => ({
        ...v,
        currentValue: v.includeInOptimization 
          ? v.min + Math.random() * (v.max - v.min)
          : v.currentValue
      }));
      
      testVars.forEach(v => {
        if (v.includeInOptimization) {
          v.currentValue = Math.round(v.currentValue / v.step) * v.step;
        }
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
            variables: testVars.map(v => ({ 
              name: v.name, 
              value: v.currentValue,
              pattern: v.pattern,
              originalValue: v.originalValue
            })),
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
  const countEl = document.getElementById('resultsCount');
  
  if (!panel || !list) return;
  
  const allResults = optimizationResults;
  
  if (allResults.length === 0) {
    list.innerHTML = '<p class="text-sm text-gray-500">No valid results found.</p>';
    panel.classList.remove('hidden');
    return;
  }
  
  if (countEl) countEl.textContent = `(${allResults.length} results)`;
  
  const formatMoney = (v) => {
    const sign = v >= 0 ? '+' : '';
    return `${sign}$${v.toFixed(2)}`;
  };
  
  renderComparisonChart(allResults.slice(0, 10));
  
  list.innerHTML = allResults.map((r, i) => `
    <div class="result-card p-3 rounded-lg ${i === 0 ? 'bg-green-100 dark:bg-green-800/30 border-2 border-green-400 dark:border-green-500' : 'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600'} cursor-pointer hover:shadow-lg transition-all" data-result-index="${i}">
      <div class="flex items-center gap-3">
        <span class="w-8 h-8 flex items-center justify-center rounded-full ${i === 0 ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-white shadow-lg' : i < 3 ? 'bg-green-500 text-white' : 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300'} text-sm font-bold flex-shrink-0">${i + 1}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 text-sm flex-wrap">
            <span class="${r.result.totalGain >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} font-bold text-base">${formatMoney(r.result.totalGain)}</span>
            <span class="text-gray-300 dark:text-gray-500">|</span>
            <span class="text-blue-600 dark:text-blue-400 font-medium">${r.result.winRate?.toFixed(1)}%</span>
            <span class="text-gray-300 dark:text-gray-500">|</span>
            <span class="text-purple-600 dark:text-purple-400">${r.result.totalTrades} trades</span>
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1.5 truncate font-mono">
            ${r.variables.map(v => `${v.name}=${typeof v.value === 'number' ? v.value.toFixed(2) : v.value}`).join(', ')}
          </div>
        </div>
        <div class="flex gap-2 flex-shrink-0">
          <button class="copy-result-btn p-1.5 text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors" data-result-index="${i}" title="Copy code">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
          </button>
          <button class="view-result-btn p-1.5 text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors" data-result-index="${i}" title="View details">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
            </svg>
          </button>
          <button class="apply-result-btn px-2 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors font-medium" data-result-index="${i}">Apply</button>
        </div>
      </div>
    </div>
  `).join('');
  
  list.querySelectorAll('.apply-result-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      applyOptimizationResult(parseInt(btn.dataset.resultIndex));
    });
  });
  
  list.querySelectorAll('.copy-result-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyResultCode(parseInt(btn.dataset.resultIndex));
    });
  });
  
  list.querySelectorAll('.view-result-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showResultDetailModal(parseInt(btn.dataset.resultIndex));
    });
  });
  
  list.querySelectorAll('.result-card').forEach(card => {
    card.addEventListener('click', () => {
      showResultDetailModal(parseInt(card.dataset.resultIndex));
    });
  });
  
  setupExpandToggle();
  setupDetailModal();
  
  panel.classList.remove('hidden');
}

function renderComparisonChart(results) {
  const container = document.getElementById('comparisonBars');
  if (!container || results.length === 0) return;
  
  const maxGain = Math.max(...results.map(r => Math.abs(r.result.totalGain)), 1);
  
  container.innerHTML = results.map((r, i) => {
    const gainHeight = Math.max(5, Math.abs(r.result.totalGain) / maxGain * 100);
    const winHeight = Math.max(5, (r.result.winRate || 0));
    const isPositive = r.result.totalGain >= 0;
    
    return `
      <div class="flex flex-col items-center gap-1" style="width: ${100 / results.length}%;">
        <div class="flex gap-0.5 items-end h-24">
          <div class="w-3 rounded-t transition-all ${isPositive ? 'bg-green-500' : 'bg-red-500'}" style="height: ${gainHeight}%;" title="Gain: $${r.result.totalGain.toFixed(2)}"></div>
          <div class="w-3 bg-blue-500 rounded-t transition-all" style="height: ${winHeight}%;" title="Win Rate: ${r.result.winRate?.toFixed(1)}%"></div>
        </div>
        <span class="text-xs font-bold ${i === 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-500 dark:text-gray-400'}">#${i + 1}</span>
      </div>
    `;
  }).join('');
}

function setupExpandToggle() {
  const btn = document.getElementById('toggleResultsExpand');
  const list = document.getElementById('bestResultsList');
  const btnText = document.getElementById('expandBtnText');
  const btnIcon = document.getElementById('expandBtnIcon');
  
  if (!btn || !list) return;
  
  btn.onclick = () => {
    const expanded = list.dataset.expanded === 'true';
    if (expanded) {
      list.style.maxHeight = '350px';
      list.dataset.expanded = 'false';
      if (btnText) btnText.textContent = 'Expand';
      if (btnIcon) btnIcon.classList.remove('rotate-180');
    } else {
      list.style.maxHeight = '700px';
      list.dataset.expanded = 'true';
      if (btnText) btnText.textContent = 'Collapse';
      if (btnIcon) btnIcon.classList.add('rotate-180');
    }
  };
}

function copyResultCode(index) {
  const result = optimizationResults[index];
  if (!result) return;
  
  const code = applyVariablesToCodeFromResult(result.variables);
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.querySelector(`.copy-result-btn[data-result-index="${index}"]`);
    if (btn) {
      btn.innerHTML = '<svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>';
      setTimeout(() => {
        btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>';
      }, 2000);
    }
  });
}

function applyVariablesToCodeFromResult(resultVariables) {
  let code = generatedBotCode;
  
  resultVariables.forEach(rv => {
    if (rv.pattern && rv.originalValue !== undefined) {
      const escapedPattern = rv.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const newPattern = rv.pattern.replace(String(rv.originalValue), String(rv.value));
      code = code.replace(new RegExp(escapedPattern), newPattern);
    } else {
      const detected = detectedVariables.find(dv => dv.name === rv.name);
      if (detected && detected.pattern) {
        const escapedPattern = detected.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const newPattern = detected.pattern.replace(String(detected.originalValue), String(rv.value));
        code = code.replace(new RegExp(escapedPattern), newPattern);
      } else {
        const escapedName = rv.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedName}\\s*=\\s*)([\\d.]+)`, 'g');
        code = code.replace(regex, `$1${rv.value}`);
      }
    }
  });
  
  return code;
}

let currentModalResultIndex = null;

function showResultDetailModal(index) {
  const modal = document.getElementById('resultDetailModal');
  const result = optimizationResults[index];
  if (!modal || !result) return;
  
  currentModalResultIndex = index;
  
  const formatMoney = (v) => {
    if (v === undefined || v === null) return '$0.00';
    const sign = v >= 0 ? '+' : '';
    return `${sign}$${v.toFixed(2)}`;
  };
  
  document.getElementById('modalRankBadge').textContent = `#${index + 1}`;
  document.getElementById('modalRankBadge').className = `w-8 h-8 flex items-center justify-center rounded-full ${index === 0 ? 'bg-gradient-to-br from-yellow-400 to-orange-500' : 'bg-green-500'} text-white font-bold`;
  
  document.getElementById('modalTotalGain').textContent = formatMoney(result.result.totalGain);
  document.getElementById('modalTotalGain').className = `text-2xl font-bold ${result.result.totalGain >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`;
  
  document.getElementById('modalWinRate').textContent = `${result.result.winRate?.toFixed(1) || 0}%`;
  document.getElementById('modalTrades').textContent = result.result.totalTrades || 0;
  
  document.getElementById('modalVariables').innerHTML = result.variables.map(v => 
    `<span class="px-2 py-1 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-mono">${v.name} = ${typeof v.value === 'number' ? v.value.toFixed(2) : v.value}</span>`
  ).join('');
  
  document.getElementById('modalDrawdown').textContent = formatMoney(-(result.result.maxDrawdown || 0));
  document.getElementById('modalRunup').textContent = formatMoney(result.result.maxRunup || 0);
  document.getElementById('modalGainLoss').textContent = (result.result.gainLossRatio || 0).toFixed(2);
  document.getElementById('modalBestTrade').textContent = formatMoney(result.result.bestTrade || 0);
  document.getElementById('modalWorstTrade').textContent = formatMoney(result.result.worstTrade || 0);
  document.getElementById('modalAvgGain').textContent = formatMoney(result.result.avgGainPerTrade || 0);
  
  const code = applyVariablesToCodeFromResult(result.variables);
  document.getElementById('modalCode').textContent = code;
  
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function setupDetailModal() {
  const modal = document.getElementById('resultDetailModal');
  const closeBtn = document.getElementById('closeDetailModal');
  const copyBtn = document.getElementById('modalCopyCode');
  const applyBtn = document.getElementById('modalApplyBtn');
  
  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    };
  }
  
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      }
    };
  }
  
  if (copyBtn) {
    copyBtn.onclick = () => {
      const code = document.getElementById('modalCode').textContent;
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Copied!';
        setTimeout(() => {
          copyBtn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg> Copy Code';
        }, 2000);
      });
    };
  }
  
  if (applyBtn) {
    applyBtn.onclick = () => {
      if (currentModalResultIndex !== null) {
        applyOptimizationResult(currentModalResultIndex);
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      }
    };
  }
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
    
    const datapoints = parseInt(document.getElementById('simDatapoints')?.value) || 2000;
    let candles = await fetchMarketData(asset, timeframe);
    if (candles.length > datapoints) {
      candles = candles.slice(-datapoints);
    }
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

// ProRealTime Documentation Management
let currentPrtDocId = null;
let prtDocs = [];

async function loadPrtDocs() {
  try {
    const response = await fetch('/api/prt-docs');
    const data = await response.json();
    prtDocs = data.docs || [];
    renderPrtDocsList();
  } catch (e) {
    console.error('Error loading PRT docs:', e);
  }
}

function renderPrtDocsList() {
  const container = document.getElementById('prtDocsList');
  if (!container) return;
  
  if (prtDocs.length === 0) {
    container.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400 italic">No documents yet</p>';
    return;
  }
  
  container.innerHTML = prtDocs.map(doc => `
    <button data-doc-id="${doc.id}" class="prt-doc-item w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${currentPrtDocId === doc.id ? 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}">
      <div class="font-medium">${doc.title}</div>
      ${doc.alwaysInclude ? '<span class="text-xs text-teal-600 dark:text-teal-400">Always included</span>' : ''}
    </button>
  `).join('');
}

function showPrtDocEditor(doc) {
  const editor = document.getElementById('prtDocEditor');
  const placeholder = document.getElementById('prtDocPlaceholder');
  const titleInput = document.getElementById('prtDocTitle');
  const keywordsInput = document.getElementById('prtDocKeywords');
  const contentInput = document.getElementById('prtDocContent');
  const alwaysIncludeCheckbox = document.getElementById('prtDocAlwaysInclude');
  const deleteBtn = document.getElementById('deletePrtDoc');
  
  if (!editor) return;
  
  currentPrtDocId = doc.id;
  titleInput.value = doc.title || '';
  keywordsInput.value = (doc.keywords || []).join(', ');
  contentInput.value = doc.content || '';
  alwaysIncludeCheckbox.checked = doc.alwaysInclude || false;
  
  deleteBtn.classList.toggle('hidden', !doc.id);
  
  editor.classList.remove('hidden');
  placeholder.classList.add('hidden');
  
  renderPrtDocsList();
}

function hidePrtDocEditor() {
  const editor = document.getElementById('prtDocEditor');
  const placeholder = document.getElementById('prtDocPlaceholder');
  
  if (editor) editor.classList.add('hidden');
  if (placeholder) placeholder.classList.remove('hidden');
  
  currentPrtDocId = null;
  renderPrtDocsList();
}

async function savePrtDoc() {
  const titleInput = document.getElementById('prtDocTitle');
  const keywordsInput = document.getElementById('prtDocKeywords');
  const contentInput = document.getElementById('prtDocContent');
  const alwaysIncludeCheckbox = document.getElementById('prtDocAlwaysInclude');
  
  const title = titleInput.value.trim();
  const content = contentInput.value.trim();
  const keywords = keywordsInput.value.split(',').map(k => k.trim()).filter(k => k);
  const alwaysInclude = alwaysIncludeCheckbox.checked;
  
  if (!title || !content) {
    alert('Title and content are required');
    return;
  }
  
  try {
    if (currentPrtDocId) {
      await fetch(`/api/prt-docs/${currentPrtDocId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, keywords, alwaysInclude })
      });
    } else {
      const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await fetch('/api/prt-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title, content, keywords, alwaysInclude })
      });
    }
    
    await loadPrtDocs();
    hidePrtDocEditor();
  } catch (e) {
    console.error('Error saving PRT doc:', e);
    alert('Failed to save document');
  }
}

async function deletePrtDoc() {
  if (!currentPrtDocId) return;
  
  if (!confirm('Are you sure you want to delete this document?')) return;
  
  try {
    await fetch(`/api/prt-docs/${currentPrtDocId}`, { method: 'DELETE' });
    await loadPrtDocs();
    hidePrtDocEditor();
  } catch (e) {
    console.error('Error deleting PRT doc:', e);
    alert('Failed to delete document');
  }
}

function initPrtDocsModal() {
  const openBtn = document.getElementById('prtDocsBtn');
  const modal = document.getElementById('prtDocsModal');
  const closeBtn = document.getElementById('closePrtDocsModal');
  const addNewBtn = document.getElementById('addNewDocBtn');
  const saveBtn = document.getElementById('savePrtDoc');
  const deleteBtn = document.getElementById('deletePrtDoc');
  const docsList = document.getElementById('prtDocsList');
  
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      loadPrtDocs();
    });
  }
  
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      hidePrtDocEditor();
    });
  }
  
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        hidePrtDocEditor();
      }
    });
  }
  
  if (addNewBtn) {
    addNewBtn.addEventListener('click', () => {
      showPrtDocEditor({ id: null, title: '', content: '', keywords: [], alwaysInclude: false });
    });
  }
  
  if (saveBtn) {
    saveBtn.addEventListener('click', savePrtDoc);
  }
  
  if (deleteBtn) {
    deleteBtn.addEventListener('click', deletePrtDoc);
  }
  
  if (docsList) {
    docsList.addEventListener('click', async (e) => {
      const docItem = e.target.closest('.prt-doc-item');
      if (!docItem) return;
      
      const docId = docItem.dataset.docId;
      const doc = prtDocs.find(d => d.id === docId);
      if (doc) {
        showPrtDocEditor(doc);
      }
    });
  }
}

initPrtDocsModal();
