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
      return null;
    }
    
    if (data.candles && data.candles.length > 0) {
      cachedData[cacheKey] = data.candles;
      setLocalStorageCache(cacheKey, data.candles, timeframe);
      return data.candles;
    }
  } catch (e) {
    console.warn('Failed to fetch live data:', e);
  }
  
  return null;
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
  loadAiStrategyHistoryFromStorage();

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
  if (data && data.length > 0) {
    candleSeries.setData(data);
    chart.timeScale().fitContent();
  } else {
    console.warn('No market data available for initial chart load');
  }
  
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
    if (data && data.length > 0) {
      candleSeries.setData(data);
      chart.timeScale().fitContent();
      clearAllDrawings();
    } else {
      alert(`Unable to load market data for ${asset}. Please try a different asset or timeframe.`);
    }
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
  const forecastTabBtn = document.getElementById('botForecastTabBtn');
  const settingsTabBtn = document.getElementById('botSettingsTabBtn');
  const simulatorTabBtn = document.getElementById('botSimulatorTabBtn');
  const aiTradingTabBtn = document.getElementById('botAiTradingTabBtn');
  const forecastContent = document.getElementById('botForecastTabContent');
  const settingsContent = document.getElementById('botSettingsTabContent');
  const simulatorContent = document.getElementById('botSimulatorTabContent');
  const aiTradingContent = document.getElementById('botAiTradingTabContent');
  
  const activeClass = 'bot-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300';
  const inactiveClass = 'bot-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700';
  const forecastActiveClass = 'bot-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5 whitespace-nowrap';
  const forecastInactiveClass = 'bot-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1.5 whitespace-nowrap';
  const aiActiveClass = 'bot-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5';
  const aiInactiveClass = 'bot-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1.5';
  
  function switchToTab(tab) {
    if (forecastTabBtn) forecastTabBtn.className = tab === 'forecast' ? forecastActiveClass : forecastInactiveClass;
    settingsTabBtn.className = tab === 'settings' ? activeClass : inactiveClass;
    simulatorTabBtn.className = tab === 'simulator' ? activeClass : inactiveClass;
    if (aiTradingTabBtn) aiTradingTabBtn.className = tab === 'aiTrading' ? aiActiveClass : aiInactiveClass;
    
    if (forecastContent) forecastContent.classList.toggle('hidden', tab !== 'forecast');
    if (settingsContent) settingsContent.classList.toggle('hidden', tab !== 'settings');
    if (simulatorContent) simulatorContent.classList.toggle('hidden', tab !== 'simulator');
    if (aiTradingContent) aiTradingContent.classList.toggle('hidden', tab !== 'aiTrading');
  }
  
  if (forecastTabBtn) {
    forecastTabBtn.addEventListener('click', () => {
      switchToTab('forecast');
      loadForecastFromStorage();
    });
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
  
  // Forecast tab handlers
  setupForecastHandlers();
}

function setupAiTradingSubTabs() {
  const strategySubTab = document.getElementById('aiStrategySubTab');
  const resultsSubTab = document.getElementById('aiResultsSubTab');
  const memorySubTab = document.getElementById('aiMemorySubTab');
  const strategyContent = document.getElementById('aiStrategyContent');
  const resultsContent = document.getElementById('aiResultsContent');
  const memoryContent = document.getElementById('aiMemoryContent');
  
  const activeClass = 'ai-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 flex items-center gap-1.5';
  const inactiveClass = 'ai-sub-tab px-4 py-2 rounded-lg text-sm font-medium transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1.5';
  
  function setActiveTab(active) {
    [strategySubTab, resultsSubTab, memorySubTab].forEach(tab => {
      if (tab) tab.className = tab === active ? activeClass : inactiveClass;
    });
    [strategyContent, resultsContent, memoryContent].forEach(content => {
      if (content) content.classList.add('hidden');
    });
  }
  
  if (strategySubTab) {
    strategySubTab.addEventListener('click', () => {
      setActiveTab(strategySubTab);
      if (strategyContent) strategyContent.classList.remove('hidden');
    });
  }
  
  if (resultsSubTab) {
    resultsSubTab.addEventListener('click', () => {
      setActiveTab(resultsSubTab);
      if (resultsContent) resultsContent.classList.remove('hidden');
      
      // Resize chart if it exists (don't reload, just resize to fit container)
      setTimeout(() => {
        if (aiProjectionChart) {
          const container = document.getElementById('aiProjectionChart');
          if (container) {
            const rect = container.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              aiProjectionChart.resize(rect.width, rect.height);
            }
          }
        }
      }, 100);
    });
  }
  
  if (memorySubTab) {
    memorySubTab.addEventListener('click', () => {
      setActiveTab(memorySubTab);
      if (memoryContent) memoryContent.classList.remove('hidden');
      loadAiMemoryData();
    });
  }
  
  // AI Memory tab event listeners
  setupAiMemoryEventListeners();
  
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
  
  // AI Results timeframe buttons
  setupAiResultsTimeframes();
  
  // AI Projection chart height slider
  const aiChartHeightSlider = document.getElementById('aiProjectionChartHeight');
  const aiChartHeightLabel = document.getElementById('aiProjectionChartHeightLabel');
  if (aiChartHeightSlider) {
    aiChartHeightSlider.addEventListener('input', () => {
      const height = aiChartHeightSlider.value;
      if (aiChartHeightLabel) aiChartHeightLabel.textContent = height;
      const container = document.getElementById('aiProjectionChart');
      if (container && aiProjectionChart) {
        container.style.height = `${height}px`;
        aiProjectionChart.resize(container.clientWidth, parseInt(height));
      }
    });
  }
  
  // Restore cached AI results from localStorage
  restoreCachedAiResults();
  
  // AI Projection candles selector - just stores value, refresh button triggers update
  // (No auto-update on change - user clicks Refresh to apply)
  
  // Toggle projection list panel
  const toggleListBtn = document.getElementById('toggleProjectionList');
  const listPanel = document.getElementById('projectionListPanel');
  const listChevron = document.getElementById('projectionListChevron');
  if (toggleListBtn && listPanel) {
    toggleListBtn.addEventListener('click', () => {
      listPanel.classList.toggle('hidden');
      if (listChevron) listChevron.classList.toggle('rotate-180');
    });
  }
  
  // Backtest offset selector - just stores value, refresh button triggers update
  // (No auto-update on change - user clicks Refresh to apply)
  
  // Refresh chart button
  const refreshBtn = document.getElementById('refreshProjectionChart');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      console.log('Refresh chart button clicked');
      forceRefreshProjectionChart();
    });
  }
  
  // Start real price updates for AI projection
  startRealPriceUpdates();
}

// Force refresh projection chart
function forceRefreshProjectionChart() {
  const backtestOffset = parseInt(document.getElementById('aiBacktestOffset')?.value || '0');
  
  // Clear existing chart
  if (aiProjectionChart) {
    aiProjectionChart.remove();
    aiProjectionChart = null;
  }
  
  if (backtestOffset > 0) {
    // Backtest mode
    runBacktestOffsetAnalysis();
  } else if (window.lastAiResult) {
    // Live mode - force update
    updateAiProjectionChart(window.lastAiResult);
  } else {
    // No data - show message
    const container = document.getElementById('aiProjectionChart');
    if (container) {
      container.innerHTML = '<div class="h-full flex items-center justify-center text-gray-500">Run AI Analysis first to see projections</div>';
    }
  }
}

// Current selected AI Results timeframe
let aiResultsTimeframe = '5m';

function setupAiResultsTimeframes() {
  const container = document.getElementById('aiResultsTimeframeBtns');
  if (!container) return;
  
  const buttons = container.querySelectorAll('.ai-tf-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      aiResultsTimeframe = btn.dataset.tf;
      
      // Update button styles
      buttons.forEach(b => {
        if (b.dataset.tf === aiResultsTimeframe) {
          b.className = 'ai-tf-btn px-3 py-1 text-xs font-medium bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded-lg';
        } else {
          b.className = 'ai-tf-btn px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg';
        }
      });
      
      // Update display for selected timeframe (reuse existing data, just recalculate projection)
      if (window.lastAiResult) {
        updateAiResultsForTimeframe(aiResultsTimeframe, window.lastAiResult);
      }
    });
  });
}

// Cache AI results to localStorage for persistence across tab switches
function cacheAiResults(result) {
  try {
    const cacheData = {
      result,
      timestamp: Date.now(),
      timeframe: aiResultsTimeframe
    };
    localStorage.setItem('cachedAiResults', JSON.stringify(cacheData));
  } catch (e) {
    console.log('Failed to cache AI results:', e);
  }
}

// Restore cached AI results from localStorage
function restoreCachedAiResults() {
  try {
    const cached = localStorage.getItem('cachedAiResults');
    if (cached) {
      const { result, timestamp } = JSON.parse(cached);
      // Only use cache if less than 1 hour old
      if (Date.now() - timestamp < 3600000 && result) {
        window.lastAiResult = result;
        console.log('Restored cached AI results from', new Date(timestamp).toLocaleTimeString());
      }
    }
  } catch (e) {
    console.log('Failed to restore cached AI results:', e);
  }
}

function updateAiResultsForTimeframe(tf, result) {
  // Update price targets title
  const targetsTitle = document.getElementById('aiPriceTargetsTitle');
  if (targetsTitle) {
    targetsTitle.textContent = `Price Targets (${tf})`;
  }
  
  // Get timeframe-specific predictions from result
  const tfData = result.predictions?.[tf] || result.predictions?.['5m'] || {};
  
  // Update directional bias
  updateDirectionalBias(result.predictions || {});
  
  // Update price targets
  updatePriceTargets(tfData, tf);
  
  // Update probability curve
  updateProbabilityCurve(tfData);
  
  // Update projection chart
  updateAiProjectionChart(result);
}

function updateDirectionalBias(predictions) {
  const container = document.getElementById('aiDirectionalBias');
  if (!container) return;
  
  const timeframes = ['1s', '2s', '3s', '5s', '10s', '30s', '1m', '5m', '15m', '1h', '4h', '1d'];
  
  container.innerHTML = timeframes.map(tf => {
    const data = predictions[tf] || {};
    const direction = data.direction || 'Neutral';
    const confidence = data.confidence || 0;
    const confDots = Math.round(confidence / 20);
    
    let dirClass = 'text-gray-500 dark:text-gray-400';
    if (direction === 'Long') dirClass = 'text-green-600 dark:text-green-400';
    else if (direction === 'Short') dirClass = 'text-red-600 dark:text-red-400';
    else if (direction === 'Range') dirClass = 'text-blue-600 dark:text-blue-400';
    
    return `
      <div class="flex items-center justify-between ${tf === aiResultsTimeframe ? 'bg-purple-50 dark:bg-purple-900/20 -mx-2 px-2 py-1 rounded' : ''}">
        <span class="text-sm text-gray-600 dark:text-gray-400">${tf}</span>
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium ${dirClass}">${direction}</span>
          <span class="text-yellow-500">${'●'.repeat(confDots)}${'○'.repeat(5 - confDots)}</span>
          <span class="text-xs text-gray-500">(${confidence}%)</span>
        </div>
      </div>
    `;
  }).join('');
}

function updatePriceTargets(tfData, tf) {
  const tbody = document.getElementById('aiPriceTargetsBody');
  if (!tbody) return;
  
  const targets = tfData.targets || [];
  
  if (targets.length === 0) {
    tbody.innerHTML = `
      <tr><td class="py-2 text-gray-500" colspan="3">No targets available for ${tf}</td></tr>
    `;
    return;
  }
  
  tbody.innerHTML = targets.map(t => {
    const isPositive = t.change >= 0;
    const colorClass = t.type === 'Risk' ? 'red' : (t.type === 'Stretch' ? 'amber' : 'green');
    
    return `
      <tr>
        <td class="py-2 font-medium text-${colorClass}-600 dark:text-${colorClass}-400">${isPositive ? '+' : ''}${t.change}%</td>
        <td class="py-2">
          <div class="flex items-center gap-2">
            <div class="w-20 bg-gray-200 dark:bg-gray-600 rounded-full h-2">
              <div class="bg-${colorClass}-500 h-2 rounded-full" style="width: ${t.probability}%"></div>
            </div>
            <span>${t.probability}%</span>
          </div>
        </td>
        <td class="py-2"><span class="px-2 py-0.5 text-xs bg-${colorClass}-100 dark:bg-${colorClass}-900/30 text-${colorClass}-700 dark:text-${colorClass}-300 rounded">${t.type}</span></td>
      </tr>
    `;
  }).join('');
}

function updateProbabilityCurve(tfData) {
  const container = document.getElementById('aiProbabilityCurve');
  const skewEl = document.getElementById('aiProbSkew');
  const confEl = document.getElementById('aiProbConfidence');
  
  if (!container) return;
  
  const targets = tfData.targets || [];
  const direction = tfData.direction || 'Neutral';
  const confidence = (tfData.confidence || 50) / 100;
  
  // Calculate price range from targets
  let minChange = -0.1, maxChange = 0.3, peakPos = 100;
  if (targets.length > 0) {
    const changes = targets.map(t => t.change);
    minChange = Math.min(...changes, -0.1);
    maxChange = Math.max(...changes, 0.1);
    
    // Find peak based on primary target
    const primary = targets.find(t => t.type === 'Primary');
    if (primary) {
      const range = maxChange - minChange;
      peakPos = ((primary.change - minChange) / range) * 180 + 10;
    }
  }
  
  // Determine skew based on direction
  let skew = 'Neutral';
  let skewClass = 'text-gray-400';
  if (direction === 'Long') { skew = 'Upside'; skewClass = 'text-green-600 dark:text-green-400'; }
  else if (direction === 'Short') { skew = 'Downside'; skewClass = 'text-red-600 dark:text-red-400'; }
  
  // Create asymmetric bell curve based on direction
  const leftWidth = direction === 'Long' ? 40 : (direction === 'Short' ? 80 : 60);
  const rightWidth = direction === 'Long' ? 80 : (direction === 'Short' ? 40 : 60);
  const peakHeight = 20 + (confidence * 30);
  
  container.innerHTML = `
    <svg viewBox="0 0 200 80" class="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="curveGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:rgb(147, 51, 234);stop-opacity:0.3" />
          <stop offset="100%" style="stop-color:rgb(147, 51, 234);stop-opacity:0.05" />
        </linearGradient>
      </defs>
      <path d="M 10 70 Q ${peakPos - leftWidth} 70 ${peakPos - leftWidth/2} 50 Q ${peakPos - 10} 30 ${peakPos} ${peakHeight} Q ${peakPos + 10} 30 ${peakPos + rightWidth/2} 50 Q ${peakPos + rightWidth} 70 190 70" stroke="rgb(147, 51, 234)" stroke-width="2" fill="none"/>
      <path d="M 10 70 Q ${peakPos - leftWidth} 70 ${peakPos - leftWidth/2} 50 Q ${peakPos - 10} 30 ${peakPos} ${peakHeight} Q ${peakPos + 10} 30 ${peakPos + rightWidth/2} 50 Q ${peakPos + rightWidth} 70 190 70 L 190 70 L 10 70 Z" fill="url(#curveGradient)"/>
      <text x="20" y="78" class="fill-gray-400" style="font-size: 8px">${minChange.toFixed(2)}%</text>
      <text x="95" y="78" class="fill-gray-400" style="font-size: 8px">0</text>
      <text x="165" y="78" class="fill-gray-400" style="font-size: 8px">+${maxChange.toFixed(2)}%</text>
      <line x1="${peakPos}" y1="${peakHeight}" x2="${peakPos}" y2="70" stroke="rgb(147, 51, 234)" stroke-width="1" stroke-dasharray="2"/>
    </svg>
  `;
  
  if (skewEl) {
    skewEl.textContent = skew;
    skewEl.className = skewClass;
  }
  if (confEl) {
    confEl.textContent = confidence.toFixed(2);
  }
}

// Fetch higher timeframe data for multi-timeframe context
async function fetchHigherTimeframeContext(symbol, currentTF, currentInterval) {
  // Map current timeframe to higher timeframe for context
  const higherTFMap = {
    '1s': '1m', '2s': '1m', '3s': '1m', '5s': '1m', '10s': '1m', '30s': '1m',
    '1m': '1h', '5m': '1h', '15m': '4h',
    '1h': '4h', '4h': '1d', '1d': '1d'
  };
  
  const higherTF = higherTFMap[currentTF] || '1d';
  
  // Map to API timeframe
  const apiMap = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' };
  const apiTimeframe = apiMap[higherTF] || '1h';
  
  try {
    const response = await fetch(`/api/market-data/${symbol}/${apiTimeframe}`);
    if (!response.ok) return null;
    
    const data = await response.json();
    if (!data.candles || data.candles.length < 30) return null;
    
    // Analyze higher timeframe data
    return analyzeHistoricalData(data.candles);
  } catch (e) {
    console.error('Failed to fetch higher TF data:', e);
    return null;
  }
}

// Multi-timeframe wave analysis for projections
function analyzeHistoricalData(candles) {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const n = closes.length;
  
  if (n < 20) {
    return { trend: 0, volatility: 0.01, waveInfo: null, indicators: {} };
  }
  
  // Calculate SMAs for trend detection
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const sma50 = n >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : sma20;
  const sma100 = n >= 100 ? closes.slice(-100).reduce((a, b) => a + b, 0) / 100 : sma50;
  const sma200 = n >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : sma100;
  
  // EMA calculation
  const calcEMA = (data, period) => {
    const k = 2 / (period + 1);
    let ema = data.slice(0, Math.min(period, data.length)).reduce((a, b) => a + b, 0) / Math.min(period, data.length);
    for (let i = Math.min(period, data.length); i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  };
  
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, Math.min(50, n));
  
  // RSI
  let gains = 0, losses = 0;
  const rsiPeriod = Math.min(14, n - 1);
  for (let i = n - rsiPeriod; i < n; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / rsiPeriod;
  const avgLoss = losses / rsiPeriod;
  const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  
  // MACD
  const ema12 = calcEMA(closes, Math.min(12, n));
  const ema26 = calcEMA(closes, Math.min(26, n));
  const macd = ema12 - ema26;
  
  // Volatility (standard deviation of returns)
  let priceChanges = [];
  for (let i = 1; i < n; i++) {
    priceChanges.push((closes[i] - closes[i-1]) / closes[i-1]);
  }
  const avgChange = priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length;
  const volatility = Math.sqrt(priceChanges.reduce((sum, c) => sum + Math.pow(c - avgChange, 2), 0) / priceChanges.length) || 0.01;
  
  // Trend strength (-1 to +1)
  let trendScore = 0;
  const currentPrice = closes[n - 1];
  
  // SMA alignment
  if (currentPrice > sma20) trendScore += 0.15;
  else trendScore -= 0.15;
  if (currentPrice > sma50) trendScore += 0.15;
  else trendScore -= 0.15;
  if (currentPrice > sma100) trendScore += 0.1;
  else trendScore -= 0.1;
  if (currentPrice > sma200) trendScore += 0.1;
  else trendScore -= 0.1;
  
  // EMA alignment
  if (ema9 > ema21) trendScore += 0.15;
  else trendScore -= 0.15;
  if (ema21 > ema50) trendScore += 0.1;
  else trendScore -= 0.1;
  
  // RSI contribution
  if (rsi > 50) trendScore += (rsi - 50) / 200;
  else trendScore -= (50 - rsi) / 200;
  
  // MACD contribution
  if (macd > 0) trendScore += 0.1;
  else trendScore -= 0.1;
  
  // Clamp trend score
  trendScore = Math.max(-1, Math.min(1, trendScore));
  
  // Detect wave structure (swing highs/lows)
  const swings = detectSwings(candles);
  const waveInfo = analyzeWaveStructure(swings, currentPrice);
  
  // Higher timeframe trend (using longer lookback)
  const longTermTrend = n >= 100 ? 
    (closes[n-1] - closes[n-100]) / closes[n-100] : 
    (closes[n-1] - closes[0]) / closes[0];
  
  return {
    trend: trendScore,
    longTermTrend,
    volatility,
    waveInfo,
    indicators: {
      sma20, sma50, sma100, sma200,
      ema9, ema21, ema50,
      rsi, macd,
      currentPrice
    }
  };
}

// Detect swing highs and lows
function detectSwings(candles, lookback = 5) {
  const swings = [];
  const n = candles.length;
  
  for (let i = lookback; i < n - lookback; i++) {
    let isHigh = true, isLow = true;
    
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    
    if (isHigh) {
      swings.push({ type: 'high', price: candles[i].high, time: candles[i].time, index: i });
    }
    if (isLow) {
      swings.push({ type: 'low', price: candles[i].low, time: candles[i].time, index: i });
    }
  }
  
  return swings.sort((a, b) => a.index - b.index);
}

// Analyze wave structure from swings
function analyzeWaveStructure(swings, currentPrice) {
  if (swings.length < 4) {
    return { waveCount: 0, avgWaveHeight: 0, avgWaveLength: 0, currentPhase: 'unknown' };
  }
  
  // Calculate average wave characteristics
  const waves = [];
  for (let i = 1; i < swings.length; i++) {
    const prev = swings[i-1];
    const curr = swings[i];
    waves.push({
      height: Math.abs(curr.price - prev.price),
      length: curr.index - prev.index,
      direction: curr.type === 'high' ? 'up' : 'down'
    });
  }
  
  const avgWaveHeight = waves.reduce((a, w) => a + w.height, 0) / waves.length;
  const avgWaveLength = waves.reduce((a, w) => a + w.length, 0) / waves.length;
  
  // Determine current phase
  const lastSwing = swings[swings.length - 1];
  const distFromSwing = currentPrice - lastSwing.price;
  const progressFromSwing = Math.abs(distFromSwing) / avgWaveHeight;
  
  let currentPhase;
  if (lastSwing.type === 'low') {
    if (distFromSwing > 0) currentPhase = 'upwave';
    else currentPhase = 'breakdown';
  } else {
    if (distFromSwing < 0) currentPhase = 'downwave';
    else currentPhase = 'breakout';
  }
  
  // Detect nested waves (larger cycle)
  const highs = swings.filter(s => s.type === 'high').map(s => s.price);
  const lows = swings.filter(s => s.type === 'low').map(s => s.price);
  const overallHigh = Math.max(...highs);
  const overallLow = Math.min(...lows);
  const positionInCycle = highs.length > 0 && lows.length > 0 ? 
    (currentPrice - overallLow) / (overallHigh - overallLow) : 0.5;
  
  return {
    waveCount: waves.length,
    avgWaveHeight,
    avgWaveLength,
    currentPhase,
    progressFromSwing,
    positionInCycle,
    lastSwingType: lastSwing.type,
    lastSwingPrice: lastSwing.price
  };
}

// Generate wave-based projections
// Generate AI-powered price projection using learned patterns and brain memory
async function generateAiProjection(symbol, tf, historicalCandles, lastPrice, lastTime, interval, projectionPoints, direction, aiResult) {
  console.log('Generating AI projection with learned patterns...');
  
  // Prepare recent price data for AI analysis (last 50 candles for context)
  const recentCandles = historicalCandles.slice(-50);
  const priceData = recentCandles.map(c => ({
    time: c.time,
    open: c.open.toFixed(4),
    high: c.high.toFixed(4),
    low: c.low.toFixed(4),
    close: c.close.toFixed(4)
  }));
  
  // Get brain memory data for context
  let brainData = null;
  let eventsData = null;
  try {
    const [brainRes, eventsRes] = await Promise.all([
      fetch('/api/ai-memory/brain'),
      fetch('/api/ai-memory/events')
    ]);
    if (brainRes.ok) brainData = await brainRes.json();
    if (eventsRes.ok) eventsData = await eventsRes.json();
  } catch (e) {
    console.log('Could not fetch brain memory:', e.message);
  }
  
  // Extract relevant learned patterns for this asset
  const assetPatterns = brainData?.patterns?.[symbol] || {};
  const accuracy = brainData?.accuracy?.[symbol] || 0;
  const predictions = brainData?.predictions?.[symbol] || 0;
  // Handle both array and object with events property
  const eventsArray = Array.isArray(eventsData) ? eventsData : (eventsData?.events || []);
  const recentEvents = eventsArray.slice(-10);
  
  // Build AI prompt
  const prompt = `You are analyzing ${symbol} on the ${tf} timeframe to predict future price movement.

CURRENT PRICE: ${lastPrice.toFixed(4)}
CURRENT DIRECTION BIAS: ${direction}
AI CONFIDENCE: ${aiResult?.confidence || 'Unknown'}

RECENT PRICE DATA (last 50 candles):
${JSON.stringify(priceData.slice(-20), null, 1)}

LEARNED PATTERNS FOR ${symbol.toUpperCase()}:
- Historical Accuracy: ${(accuracy * 100).toFixed(1)}% from ${predictions} predictions
- Detected Patterns: ${JSON.stringify(assetPatterns)}

RECENT MARKET EVENTS:
${recentEvents.map(e => `- ${e.date}: ${e.title} (Impact: ${e.impact})`).join('\n') || 'None recorded'}

AI ANALYSIS RESULTS:
${JSON.stringify(aiResult?.predictions?.[tf] || {}, null, 1)}

Based on your analysis of the patterns, trends, and learned data, predict the next ${projectionPoints} price points.

RESPOND WITH ONLY A JSON OBJECT in this exact format:
{
  "expected": [array of ${projectionPoints} predicted prices for most likely scenario],
  "bullish": [array of ${projectionPoints} prices for bullish scenario],
  "bearish": [array of ${projectionPoints} prices for bearish scenario],
  "reasoning": "Brief explanation of your prediction logic"
}

Make realistic predictions that reflect actual market behavior - not random waves. Consider:
1. Current trend direction and momentum
2. Support/resistance levels visible in the data
3. Typical price movement patterns for this asset
4. Your learned accuracy and past pattern performance`;

  try {
    const response = await fetch('/api/ai/generate-projection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        symbol,
        timeframe: tf,
        currentPrice: lastPrice,
        projectionPoints
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('AI projection response:', data);
      
      if (data.expected && data.bullish && data.bearish) {
        // Calculate realistic volatility from historical data
        const volatilities = [];
        for (let i = 1; i < recentCandles.length; i++) {
          volatilities.push(Math.abs(recentCandles[i].close - recentCandles[i-1].close) / recentCandles[i-1].close);
        }
        const avgVolatility = volatilities.reduce((a, b) => a + b, 0) / volatilities.length;
        const volatilityMultiplier = lastPrice * avgVolatility * 0.8; // Slightly dampen for projection
        
        // Convert AI predictions to chart data format with realistic volatility
        const bullishData = [{ time: lastTime, value: lastPrice }];
        const bearishData = [{ time: lastTime, value: lastPrice }];
        const expectedData = [{ time: lastTime, value: lastPrice }];
        
        // Random walk with mean reversion to AI target
        let expPrice = lastPrice, bullPrice = lastPrice, bearPrice = lastPrice;
        
        for (let i = 0; i < data.expected.length; i++) {
          const time = lastTime + ((i + 1) * interval);
          const targetExp = parseFloat(data.expected[i]) || lastPrice;
          const targetBull = parseFloat(data.bullish[i]) || lastPrice;
          const targetBear = parseFloat(data.bearish[i]) || lastPrice;
          
          // Add realistic noise - random walk with drift toward AI target
          const noise1 = (Math.random() - 0.5) * volatilityMultiplier * 2;
          const noise2 = (Math.random() - 0.5) * volatilityMultiplier * 2;
          const noise3 = (Math.random() - 0.5) * volatilityMultiplier * 2;
          
          // Mean reversion factor (stronger as we get further from target)
          const reversionStrength = 0.15;
          expPrice += (targetExp - expPrice) * reversionStrength + noise1;
          bullPrice += (targetBull - bullPrice) * reversionStrength + noise2;
          bearPrice += (targetBear - bearPrice) * reversionStrength + noise3;
          
          expectedData.push({ time, value: expPrice });
          bullishData.push({ time, value: bullPrice });
          bearishData.push({ time, value: bearPrice });
        }
        
        // Store reasoning for display
        window.aiProjectionReasoning = data.reasoning || '';
        
        return { bullishData, bearishData, expectedData };
      }
    }
  } catch (e) {
    console.error('AI projection failed:', e);
  }
  
  // Fallback: use simple trend-based projection if AI fails
  console.log('Using fallback projection');
  return generateFallbackProjection(historicalCandles, lastPrice, lastTime, interval, projectionPoints, direction);
}

// Simple fallback projection based on recent trend with realistic volatility
function generateFallbackProjection(historicalCandles, lastPrice, lastTime, interval, projectionPoints, direction) {
  const bullishData = [{ time: lastTime, value: lastPrice }];
  const bearishData = [{ time: lastTime, value: lastPrice }];
  const expectedData = [{ time: lastTime, value: lastPrice }];
  
  // Calculate recent trend from last 20 candles
  const recent = historicalCandles.slice(-20);
  const avgChange = (recent[recent.length - 1].close - recent[0].close) / recent.length;
  
  // Calculate realistic volatility from actual price movements
  const volatilities = [];
  for (let i = 1; i < recent.length; i++) {
    volatilities.push(Math.abs(recent[i].close - recent[i-1].close));
  }
  const avgVolatility = volatilities.reduce((a, b) => a + b, 0) / volatilities.length;
  
  let expPrice = lastPrice;
  let bullPrice = lastPrice;
  let bearPrice = lastPrice;
  
  // Direction bias
  const dirBias = direction === 'Bullish' ? 1.2 : direction === 'Bearish' ? 0.8 : 1;
  
  for (let i = 1; i <= projectionPoints; i++) {
    const time = lastTime + (i * interval);
    
    // Trend with dampening
    const trendFactor = Math.max(0.1, 1 - (i / projectionPoints) * 0.5);
    const trend = avgChange * trendFactor;
    
    // Random walk noise (realistic market movement)
    const noise1 = (Math.random() - 0.5) * avgVolatility * 2;
    const noise2 = (Math.random() - 0.5) * avgVolatility * 2;
    const noise3 = (Math.random() - 0.5) * avgVolatility * 2;
    
    expPrice += trend + noise1;
    bullPrice += trend * dirBias + Math.abs(trend * 0.5) + noise2;
    bearPrice += trend / dirBias - Math.abs(trend * 0.5) + noise3;
    
    expectedData.push({ time, value: expPrice });
    bullishData.push({ time, value: bullPrice });
    bearishData.push({ time, value: bearPrice });
  }
  
  return { bullishData, bearishData, expectedData };
}

function generateWaveProjections(historicalCandles, lastPrice, lastTime, interval, forecastCandles, direction, analysis) {
  const bullishData = [];
  const bearishData = [];
  const expectedData = [];
  
  const { trend, longTermTrend, volatility, waveInfo, indicators } = analysis;
  
  // Get higher timeframe context (if available)
  const higherTFTrend = analysis.higherTFTrend || trend;
  const higherTFLongTermTrend = analysis.higherTFLongTermTrend || longTermTrend;
  const higherTFVolatility = analysis.higherTFVolatility || volatility;
  
  console.log('Wave generation inputs:', {
    localTrend: trend?.toFixed(3),
    higherTFTrend: higherTFTrend?.toFixed(3),
    volatility: volatility?.toFixed(4),
    waveHeight: waveInfo?.avgWaveHeight?.toFixed(4),
    waveLength: waveInfo?.avgWaveLength?.toFixed(1)
  });
  
  // Seeded random for consistency
  let randomSeed = Math.floor(lastPrice * 1000 + lastTime);
  const seededRandom = () => {
    randomSeed = (randomSeed * 1103515245 + 12345) & 0x7fffffff;
    return (randomSeed / 0x7fffffff) * 2 - 1;
  };
  
  // Wave parameters based on analysis with proper fallbacks
  // Calculate price range from historical data for realistic wave amplitude
  const priceHigh = Math.max(...historicalCandles.map(c => c.high));
  const priceLow = Math.min(...historicalCandles.map(c => c.low));
  const priceRange = priceHigh - priceLow;
  
  // Use price range as baseline for wave height (more realistic than volatility alone)
  const minWaveHeight = Math.max(priceRange * 0.3, lastPrice * volatility * 20);
  const avgWaveLength = waveInfo?.avgWaveLength > 10 ? waveInfo.avgWaveLength : Math.max(30, historicalCandles.length / 10);
  const avgWaveHeight = waveInfo?.avgWaveHeight > minWaveHeight * 0.5 ? waveInfo.avgWaveHeight : minWaveHeight;
  const positionInCycle = waveInfo?.positionInCycle ?? 0.5;
  
  console.log('Wave amplitude calculation:', {
    priceRange: priceRange.toFixed(2),
    minWaveHeight: minWaveHeight.toFixed(4),
    avgWaveHeight: avgWaveHeight.toFixed(4),
    avgWaveLength: avgWaveLength.toFixed(1),
    detectedWaves: waveInfo?.waveCount || 0
  });
  
  // Determine primary wave frequency (longer cycle) - scale with forecast length
  const scaleFactor = Math.max(1, forecastCandles / 500);
  const primaryWaveLength = avgWaveLength * 4 * scaleFactor; // Large wave
  const secondaryWaveLength = avgWaveLength * scaleFactor; // Medium wave
  const tertiaryWaveLength = Math.max(5, avgWaveLength / 4); // Small wave (ripples)
  
  // Combined trend from local + higher TF (higher TF weighted more heavily)
  const combinedTrend = (trend * 0.3 + higherTFTrend * 0.7);
  
  // Scale drift based on forecast length - longer forecasts need smaller per-candle drift
  // to prevent runaway diagonal lines
  const driftScaleFactor = Math.min(1, 100 / forecastCandles);
  
  // Trend-based drift incorporating higher TF (reduced to prevent diagonal dominance)
  const trendDrift = combinedTrend * volatility * 0.05 * driftScaleFactor;
  const longTermDrift = (higherTFLongTermTrend > 0.01 ? 0.00005 : (higherTFLongTermTrend < -0.01 ? -0.00005 : 0)) * driftScaleFactor;
  
  // Direction bias from AI prediction (reduced)
  const directionBias = (direction === 'Long' ? 0.00005 : (direction === 'Short' ? -0.00005 : 0)) * driftScaleFactor;
  
  // Initialize prices
  let bullPrice = lastPrice;
  let bearPrice = lastPrice;
  let expPrice = lastPrice;
  
  // Phase offsets for waves (based on current position in cycle)
  const basePhase = positionInCycle * Math.PI * 2;
  const bullPhaseOffset = -Math.PI / 6; // Slightly ahead
  const bearPhaseOffset = Math.PI / 6; // Slightly behind
  
  for (let i = 0; i <= forecastCandles; i++) {
    const time = lastTime + (i * interval);
    
    if (i === 0) {
      bullishData.push({ time, value: bullPrice });
      bearishData.push({ time, value: bearPrice });
      expectedData.push({ time, value: expPrice });
      continue;
    }
    
    // Calculate wave components
    const t = i;
    
    // Primary wave (long cycle) - main market wave
    const primaryWave = Math.sin((t / primaryWaveLength) * Math.PI * 2 + basePhase);
    
    // Secondary wave (medium cycle) - within the primary
    const secondaryWave = Math.sin((t / secondaryWaveLength) * Math.PI * 2 + basePhase * 1.5) * 0.4;
    
    // Tertiary wave (short cycle) - ripples/noise
    const tertiaryWave = Math.sin((t / tertiaryWaveLength) * Math.PI * 2 + basePhase * 2) * 0.15;
    
    // Combined wave with noise
    const noise = seededRandom() * 0.2;
    const combinedWave = primaryWave + secondaryWave + tertiaryWave + noise;
    
    // Calculate wave amplitude based on volatility - make waves visible
    const waveAmplitude = avgWaveHeight;
    
    // Calculate position-based wave value (oscillates around 0)
    const bullWaveOffset = Math.sin((t / primaryWaveLength) * Math.PI * 2 + basePhase + bullPhaseOffset);
    const bearWaveOffset = Math.sin((t / primaryWaveLength) * Math.PI * 2 + basePhase + bearPhaseOffset);
    
    // Bullish projection: oscillates with upward bias
    const bullWaveValue = (primaryWave + secondaryWave + tertiaryWave + noise) * 0.6 + bullWaveOffset * 0.4;
    bullPrice = lastPrice + (bullWaveValue * waveAmplitude * 0.5) + (i * trendDrift * lastPrice) + (i * directionBias * lastPrice);
    
    // Bearish projection: oscillates with downward bias  
    const bearWaveValue = (primaryWave + secondaryWave + tertiaryWave + noise) * 0.6 + bearWaveOffset * 0.4;
    bearPrice = lastPrice + (bearWaveValue * waveAmplitude * 0.5) - (i * trendDrift * lastPrice) - (i * directionBias * lastPrice);
    
    // Expected projection: oscillates with slight trend
    const expWaveValue = primaryWave + secondaryWave * 0.5 + tertiaryWave * 0.3 + noise * 0.5;
    expPrice = lastPrice + (expWaveValue * waveAmplitude * 0.4) + (i * (trendDrift + longTermDrift + directionBias) * lastPrice * 0.5);
    
    // Occasional spike/dip (5% chance) based on volatility
    if (Math.abs(seededRandom()) > 0.95) {
      const spikeSize = seededRandom() * volatility * 2;
      bullPrice *= (1 + Math.abs(spikeSize));
      bearPrice *= (1 - Math.abs(spikeSize));
      expPrice *= (1 + spikeSize * 0.5);
    }
    
    // Keep within reasonable bounds (prevent runaway)
    const maxMove = 0.5; // Max 50% from start
    bullPrice = Math.max(lastPrice * (1 - maxMove), Math.min(lastPrice * (1 + maxMove), bullPrice));
    bearPrice = Math.max(lastPrice * (1 - maxMove), Math.min(lastPrice * (1 + maxMove), bearPrice));
    expPrice = Math.max(lastPrice * (1 - maxMove * 0.7), Math.min(lastPrice * (1 + maxMove * 0.7), expPrice));
    
    bullishData.push({ time, value: bullPrice });
    bearishData.push({ time, value: bearPrice });
    expectedData.push({ time, value: expPrice });
  }
  
  return { bullishData, bearishData, expectedData };
}

// AI Projection Chart using Lightweight Charts
let aiProjectionChart = null;
let aiProjectionSeries = [];

async function updateAiProjectionChart(result) {
  console.log('updateAiProjectionChart called with result:', result);
  
  try {
    const container = document.getElementById('aiProjectionChart');
    if (!container) {
      console.error('Projection chart container not found');
      return;
    }
    
    // Check if container is visible (has dimensions)
    const containerRect = container.getBoundingClientRect();
    console.log('Container dimensions:', { width: containerRect.width, height: containerRect.height });
    
    if (containerRect.width === 0 || containerRect.height === 0) {
      console.warn('Chart container not visible yet, deferring render');
      container.innerHTML = '<div class="h-full flex items-center justify-center text-gray-500">Chart will render when AI Results tab is visible</div>';
      return;
    }
    
    // Get forecast candles from selector (default 10k)
    const forecastCandles = parseInt(document.getElementById('aiProjectionCandles')?.value || '10000');
    const tf = aiResultsTimeframe;
    const tfData = result.predictions?.[tf] || result.predictions?.['5m'] || {};
    
    console.log('Projection params:', { forecastCandles, tf, tfData, hasPredictions: !!result.predictions });
  
  // Timeframe intervals in seconds
  const tfSeconds = { '1s': 1, '2s': 2, '3s': 3, '5s': 5, '10s': 10, '30s': 30, '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800, '1M': 2592000 };
  const interval = tfSeconds[tf] || 300;
  
  // Always fetch fresh data for the selected timeframe
  const symbol = document.getElementById('aiSymbol')?.value || 'silver';
  
  // Map timeframe to API endpoint
  const tfApiMap = {
    '1s': '1m', '2s': '1m', '3s': '1m', '5s': '1m', '10s': '1m', '30s': '1m',
    '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d'
  };
  const apiTimeframe = tfApiMap[tf] || '1h';
  
  console.log(`Fetching ${forecastCandles} candles for ${symbol}/${tf} (API: ${apiTimeframe})`);
  
  // Update timeframe label in UI
  const tfLabel = document.getElementById('projectionTimeframeLabel');
  if (tfLabel) tfLabel.textContent = tf;
  
  let historicalCandles = [];
  try {
    container.innerHTML = '<div class="h-full flex items-center justify-center text-gray-500">Loading market data...</div>';
    const response = await fetch(`/api/market-data/${symbol}/${apiTimeframe}`);
    const data = await response.json();
    console.log('Market data response:', { status: response.status, candleCount: data.candles?.length, timeframe: apiTimeframe });
    if (data.candles && data.candles.length > 0) {
      // Use all available candles, up to requested amount
      historicalCandles = data.candles.slice(-forecastCandles);
      console.log(`Using ${historicalCandles.length} candles (requested ${forecastCandles}, available ${data.candles.length})`);
      
      // Update data info label
      const dataInfo = document.getElementById('projectionDataInfo');
      if (dataInfo) {
        const firstDate = new Date(historicalCandles[0].time * 1000).toLocaleDateString();
        const lastDate = new Date(historicalCandles[historicalCandles.length - 1].time * 1000).toLocaleDateString();
        dataInfo.textContent = `${historicalCandles.length} candles (${firstDate} - ${lastDate})`;
      }
    }
  } catch (e) {
    console.error('Failed to fetch market data:', e);
  }
  
  // Display ALL fetched historical candles (already limited by forecastCandles in fetch)
  const displayCandles = historicalCandles;
  
  console.log('Data status:', { historicalCandles: historicalCandles.length, displayCandles: displayCandles.length });
  
  if (historicalCandles.length === 0 || displayCandles.length === 0) {
    console.error('No market data available');
    container.innerHTML = '<div class="h-full flex items-center justify-center text-red-500 font-medium">No market data available - Please run AI analysis first</div>';
    return;
  }
  
  // Show data info
  console.log(`Projection: ${forecastCandles} forecast candles, ${historicalCandles.length} historical candles available, displaying ${displayCandles.length}`);
  
  // Clear previous chart
  if (aiProjectionChart) {
    aiProjectionChart.remove();
    aiProjectionChart = null;
    realPriceSeries = null; // Reset real price series reference
  }
  
  // Calculate bar spacing based on timeframe and forecast count
  // Larger timeframes and more candles = smaller bar spacing
  let barSpacing = 6;
  if (forecastCandles >= 10000) barSpacing = 0.5;
  else if (forecastCandles >= 1000) barSpacing = 2;
  else if (forecastCandles >= 100) barSpacing = 4;
  
  // Adjust for timeframe (seconds need tighter spacing)
  if (interval <= 30) barSpacing = Math.max(0.3, barSpacing * 0.5);
  else if (interval >= 3600) barSpacing = Math.min(10, barSpacing * 1.5);
  
  // Get actual dimensions from bounding rect, use height slider value
  const chartRect = container.getBoundingClientRect();
  const chartWidth = Math.max(chartRect.width, 400);
  const sliderHeight = parseInt(document.getElementById('aiProjectionChartHeight')?.value) || 400;
  container.style.height = `${sliderHeight}px`;
  const chartHeight = sliderHeight;
  
  console.log('Creating chart with dimensions:', { chartWidth, chartHeight });
  
  // Clear container before creating chart
  container.innerHTML = '';
  
  // Determine time format based on timeframe
  const useSecondsFormat = interval <= 60;
  const useDayFormat = interval >= 86400;
  
  // Generate projections first - use last candle from display for continuity
  const lastCandle = displayCandles[displayCandles.length - 1];
  const lastPrice = lastCandle.close;
  const lastTime = lastCandle.time;
  const direction = tfData.direction || 'Neutral';
  
  // Show loading state before AI generation
  container.innerHTML = '<div class="h-full flex items-center justify-center text-purple-400"><div class="text-center"><div class="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-2"></div>AI analyzing patterns and generating projection...</div></div>';
  
  // Use AI to generate intelligent price projection based on learned patterns
  const { bullishData, bearishData, expectedData } = await generateAiProjection(
    symbol,
    tf,
    historicalCandles,
    lastPrice,
    lastTime,
    interval,
    Math.min(forecastCandles, 500), // Limit projection points for AI efficiency
    direction,
    result
  );
  
  // Clear loading state and create chart AFTER AI projection is ready
  container.innerHTML = '';
  
  // Create chart with scroll/zoom enabled
  aiProjectionChart = createChart(container, {
    width: chartWidth,
    height: chartHeight,
    layout: {
      background: { type: ColorType.Solid, color: '#111827' },
      textColor: '#9ca3af',
    },
    grid: {
      vertLines: { color: '#374151' },
      horzLines: { color: '#374151' },
    },
    timeScale: {
      borderColor: '#374151',
      timeVisible: !useDayFormat,
      secondsVisible: useSecondsFormat,
      rightOffset: 5,
      barSpacing: barSpacing,
      minBarSpacing: 0.1,
      tickMarkFormatter: (time) => {
        const date = new Date(time * 1000);
        if (useDayFormat) {
          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } else if (interval >= 3600) {
          return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        } else if (interval >= 60) {
          return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        } else {
          return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
      },
    },
    rightPriceScale: {
      borderColor: '#374151',
      autoScale: true,
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false,
    },
    handleScale: {
      axisPressedMouseMove: true,
      mouseWheel: true,
      pinch: true,
    },
  });
  
  // Historical line (gray) - show only displayCandles for chart
  const historicalSeries = aiProjectionChart.addSeries(LineSeries, {
    color: '#9ca3af',
    lineWidth: 2,
  });
  historicalSeries.setData(displayCandles.map(c => ({
    time: c.time,
    value: c.close
  })));
  
  // Bullish line (green, dashed)
  const bullishSeries = aiProjectionChart.addSeries(LineSeries, {
    color: '#22c55e',
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
  });
  bullishSeries.setData(bullishData);
  
  // Bearish line (red, dashed)
  const bearishSeries = aiProjectionChart.addSeries(LineSeries, {
    color: '#ef4444',
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
  });
  bearishSeries.setData(bearishData);
  
  // AI Projected line (bright blue, solid, thicker)
  const expectedSeries = aiProjectionChart.addSeries(LineSeries, {
    color: '#3b82f6',
    lineWidth: 3,
  });
  expectedSeries.setData(expectedData);
  
  // Set initial view to show historical data + start of projection
  // Calculate visible bars based on container width and bar spacing
  const containerWidth = container.clientWidth || 600;
  const visibleBars = Math.floor(containerWidth / barSpacing);
  const historicalStart = 0;
  const projectionStart = displayCandles.length;
  
  // Show from start of historical to some projection (centered around where projection begins)
  const viewStart = Math.max(0, projectionStart - Math.floor(visibleBars * 0.3));
  const viewEnd = viewStart + visibleBars;
  
  try {
    aiProjectionChart.timeScale().setVisibleLogicalRange({
      from: viewStart,
      to: Math.min(viewEnd, displayCandles.length + forecastCandles)
    });
  } catch (e) {
    console.error('Error setting visible range:', e);
  }
  
  console.log('Chart created successfully with', { bullishDataLength: bullishData.length, bearishDataLength: bearishData.length, expectedDataLength: expectedData.length });
  
  // Store projection data for list view and real price comparison
  window.projectionData = {
    expected: expectedData,
    bullish: bullishData,
    bearish: bearishData,
    lastPrice,
    symbol: result.context?.symbol || 'Unknown',
    startTime: lastTime
  };
  
  console.log('Updating list view...');
  
  // Update list view
  updateProjectionListView(expectedData, bullishData, bearishData);
  
  } catch (error) {
    console.error('Error in updateAiProjectionChart:', error);
    const container = document.getElementById('aiProjectionChart');
    if (container) {
      container.innerHTML = `<div class="h-full flex items-center justify-center text-red-500 font-medium">Error rendering chart: ${error.message}</div>`;
    }
  }
}

// Real price line series reference
let realPriceSeries = null;
let realPriceInterval = null;

function startRealPriceUpdates() {
  // Clear existing interval
  if (realPriceInterval) {
    clearInterval(realPriceInterval);
  }
  
  // Fetch and update real prices immediately, then every 30 seconds
  fetchAndUpdateRealPrices();
  
  realPriceInterval = setInterval(fetchAndUpdateRealPrices, 30000);
}

async function fetchAndUpdateRealPrices() {
  if (!window.lastAiResult || !aiProjectionChart || !window.projectionData) return;
  
  try {
    const symbol = document.getElementById('aiSymbol')?.value || 'silver';
    // Fetch more data - 1 hour timeframe for better coverage
    const response = await fetch(`/api/market-data/${symbol}/1h`);
    const data = await response.json();
    
    if (data.candles && data.candles.length > 0) {
      // Use all available candles for comparison
      const realCandles = data.candles;
      updateRealPriceLine(realCandles);
      calculatePredictionAccuracy(realCandles);
    }
  } catch (e) {
    console.warn('Failed to fetch real price:', e);
  }
}

function updateRealPriceLine(realCandles) {
  if (!aiProjectionChart || !window.projectionData) return;
  
  const { startTime } = window.projectionData;
  
  // Show all candles that overlap with our chart view (historical + any new real data)
  // The chart shows history from ~30 candles before startTime, so include those
  const historyStart = startTime - (50 * 3600); // 50 hours back for H1 timeframe
  const relevantCandles = realCandles.filter(c => c.time >= historyStart);
  
  if (relevantCandles.length === 0) return;
  
  // Create or update real price series with bright styling
  if (!realPriceSeries) {
    realPriceSeries = aiProjectionChart.addSeries(LineSeries, {
      color: '#ef4444', // Bright red
      lineWidth: 3,
      lastValueVisible: true,
      priceLineVisible: true,
      title: 'Actual',
    });
  }
  
  realPriceSeries.setData(relevantCandles.map(c => ({
    time: c.time,
    value: c.close
  })));
}

function calculatePredictionAccuracy(realCandles) {
  if (!window.projectionData) return;
  
  const { expected, bullish, bearish, lastPrice } = window.projectionData;
  const latestReal = realCandles[realCandles.length - 1];
  
  if (!latestReal || expected.length === 0) return;
  
  // Find the projected value closest to current time
  const currentTime = latestReal.time;
  let closestProjected = expected[0];
  for (const p of expected) {
    if (Math.abs(p.time - currentTime) < Math.abs(closestProjected.time - currentTime)) {
      closestProjected = p;
    }
  }
  
  const projectedPrice = closestProjected.value;
  const actualPrice = latestReal.close;
  const deviation = ((actualPrice - projectedPrice) / projectedPrice * 100);
  const accuracy = Math.max(0, 100 - Math.abs(deviation) * 10);
  
  // Update UI
  const accuracyEl = document.getElementById('aiAccuracyValue');
  const projectedEl = document.getElementById('aiProjectedPrice');
  const actualEl = document.getElementById('aiActualPrice');
  const deviationEl = document.getElementById('aiPriceDeviation');
  
  if (accuracyEl) {
    accuracyEl.textContent = `${accuracy.toFixed(1)}%`;
    accuracyEl.className = accuracy >= 80 ? 'text-lg font-bold text-green-600' :
                           accuracy >= 60 ? 'text-lg font-bold text-yellow-600' :
                           'text-lg font-bold text-red-600';
  }
  if (projectedEl) projectedEl.textContent = `$${projectedPrice.toFixed(4)}`;
  if (actualEl) actualEl.textContent = `$${actualPrice.toFixed(4)}`;
  if (deviationEl) {
    deviationEl.textContent = `${deviation >= 0 ? '+' : ''}${deviation.toFixed(3)}%`;
    deviationEl.className = Math.abs(deviation) < 0.5 ? 'text-green-600' : 
                            Math.abs(deviation) < 1 ? 'text-yellow-600' : 'text-red-600';
  }
  
  // Update list view with actual prices
  updateProjectionListView(expected, bullish, bearish, realCandles);
}

// Backtest offset analysis - run AI analysis on historical data and compare with what actually happened
async function runBacktestOffsetAnalysis() {
  const offsetSelect = document.getElementById('aiBacktestOffset');
  const offsetSeconds = parseInt(offsetSelect?.value || '0');
  
  const summaryDiv = document.getElementById('backtestAccuracySummary');
  
  // If live mode, hide backtest summary and show regular projection
  if (offsetSeconds === 0) {
    if (summaryDiv) summaryDiv.classList.add('hidden');
    if (window.lastAiResult) {
      updateAiProjectionChart(window.lastAiResult);
    }
    return;
  }
  
  // Show loading state
  if (summaryDiv) {
    summaryDiv.classList.remove('hidden');
    document.getElementById('backtestFromTime').textContent = 'Loading...';
    document.getElementById('backtestAccuracyBadge').textContent = 'Analyzing...';
  }
  
  try {
    const symbol = document.getElementById('aiSymbol')?.value || 'silver';
    const currentTf = aiResultsTimeframe || '5m';
    
    // Map timeframe to API format and interval seconds
    const tfMap = {
      '1s': { api: '1m', interval: 1 },
      '2s': { api: '1m', interval: 2 },
      '3s': { api: '1m', interval: 3 },
      '5s': { api: '1m', interval: 5 },
      '10s': { api: '1m', interval: 10 },
      '30s': { api: '1m', interval: 30 },
      '1m': { api: '1m', interval: 60 },
      '5m': { api: '5m', interval: 300 },
      '15m': { api: '15m', interval: 900 },
      '1h': { api: '1h', interval: 3600 },
      '4h': { api: '1h', interval: 14400 },
      '1d': { api: '1d', interval: 86400 },
      '1w': { api: '1w', interval: 604800 },
      '1M': { api: '1M', interval: 2592000 }
    };
    const tfConfig = tfMap[currentTf] || { api: '1h', interval: 3600 };
    
    // Calculate backtest start time
    const now = Math.floor(Date.now() / 1000);
    const backtestTime = now - offsetSeconds;
    const backtestDate = new Date(backtestTime * 1000);
    
    // Update UI with backtest time
    document.getElementById('backtestFromTime').textContent = backtestDate.toLocaleString();
    
    // Fetch historical data in the selected timeframe
    const response = await fetch(`/api/market-data/${symbol}/${tfConfig.api}`);
    const data = await response.json();
    
    if (!data.candles || data.candles.length < 10) {
      throw new Error('Insufficient historical data for backtest');
    }
    
    // Split data: candles before backtest time (input) and after (actual results)
    const historicalCandles = data.candles.filter(c => c.time <= backtestTime);
    const actualCandles = data.candles.filter(c => c.time > backtestTime);
    
    if (historicalCandles.length < 5) {
      throw new Error('Not enough historical data before backtest point');
    }
    
    // Get the last price at backtest time
    const lastHistorical = historicalCandles[historicalCandles.length - 1];
    const startPrice = lastHistorical.close;
    
    // Run actual AI analysis on historical data (re-analyze)
    const backtestResult = await runBacktestAiAnalysis(symbol, historicalCandles);
    const aiDirection = backtestResult?.predictions?.[currentTf]?.direction || 'Neutral';
    const aiConfidence = backtestResult?.predictions?.[currentTf]?.confidence || 50;
    
    // Calculate what actually happened after the backtest point
    let actualEndPrice = startPrice;
    if (actualCandles.length > 0) {
      actualEndPrice = actualCandles[actualCandles.length - 1].close;
    }
    
    const actualChange = ((actualEndPrice - startPrice) / startPrice) * 100;
    const actualDirection = actualChange > 0.1 ? 'Long' : (actualChange < -0.1 ? 'Short' : 'Neutral');
    
    // Calculate accuracy
    const directionCorrect = (aiDirection === actualDirection) || 
                             (aiDirection === 'Long' && actualChange > 0) ||
                             (aiDirection === 'Short' && actualChange < 0);
    
    // Update accuracy UI
    document.getElementById('backtestDirResult').innerHTML = directionCorrect 
      ? `<span class="text-green-600">AI: ${aiDirection} (${aiConfidence}%) / Actual: ${actualDirection}</span>`
      : `<span class="text-red-600">AI: ${aiDirection} (${aiConfidence}%) / Actual: ${actualDirection}</span>`;
    
    document.getElementById('backtestPredicted').textContent = `$${startPrice.toFixed(4)}`;
    document.getElementById('backtestActual').textContent = `$${actualEndPrice.toFixed(4)}`;
    document.getElementById('backtestError').textContent = `${actualChange >= 0 ? '+' : ''}${actualChange.toFixed(2)}%`;
    
    // Calculate overall accuracy score
    const dirScore = directionCorrect ? 50 : 0;
    const priceScore = Math.max(0, 50 - Math.abs(actualChange) * 5);
    const totalScore = Math.round(dirScore + priceScore);
    
    const badge = document.getElementById('backtestAccuracyBadge');
    badge.textContent = `${totalScore}%`;
    if (totalScore >= 70) {
      badge.className = 'px-3 py-1 rounded-full text-sm font-bold bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300';
    } else if (totalScore >= 40) {
      badge.className = 'px-3 py-1 rounded-full text-sm font-bold bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300';
    } else {
      badge.className = 'px-3 py-1 rounded-full text-sm font-bold bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300';
    }
    
    // Render backtest chart with historical + actual overlay
    renderBacktestChart(historicalCandles, actualCandles, startPrice, aiDirection, tfConfig.interval);
    
  } catch (error) {
    console.error('Backtest error:', error);
    document.getElementById('backtestAccuracyBadge').textContent = 'Error';
    document.getElementById('backtestDirResult').textContent = error.message;
  }
}

// Run AI analysis on historical data for backtest
async function runBacktestAiAnalysis(symbol, historicalCandles) {
  try {
    const candlesForAnalysis = historicalCandles.slice(-30);
    const lastCandle = candlesForAnalysis[candlesForAnalysis.length - 1];
    const currentPrice = lastCandle?.close || 30;
    
    // Call the AI analysis endpoint with historical data (same as live analysis)
    const response = await fetch('/api/ai-strategy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        session: 'auto',
        candles: candlesForAnalysis,
        currentPrice,
        searchQuery: ''
      })
    });
    
    if (!response.ok) {
      throw new Error('AI analysis failed');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Backtest AI analysis error:', error);
    // Return a neutral result if AI fails
    return {
      predictions: {
        '5m': { direction: 'Neutral', confidence: 50 },
        '15m': { direction: 'Neutral', confidence: 50 },
        '1h': { direction: 'Neutral', confidence: 50 },
        '4h': { direction: 'Neutral', confidence: 50 }
      }
    };
  }
}

function renderBacktestChart(historicalCandles, actualCandles, startPrice, aiDirection, intervalSeconds = 3600) {
  const container = document.getElementById('aiProjectionChart');
  if (!container) return;
  
  // Use height slider value
  const sliderHeight = parseInt(document.getElementById('aiProjectionChartHeight')?.value) || 400;
  container.style.height = `${sliderHeight}px`;
  
  // Wait for container to have dimensions
  const rect = container.getBoundingClientRect();
  if (rect.width === 0) {
    console.log('Backtest chart container not visible, deferring render');
    setTimeout(() => renderBacktestChart(historicalCandles, actualCandles, startPrice, aiDirection, intervalSeconds), 100);
    return;
  }
  
  // Clear previous chart
  if (aiProjectionChart) {
    aiProjectionChart.remove();
    aiProjectionChart = null;
  }
  
  const forecastCandles = parseInt(document.getElementById('aiProjectionCandles')?.value || '100');
  
  // Create chart with slider height
  aiProjectionChart = createChart(container, {
    width: rect.width,
    height: sliderHeight,
    layout: {
      background: { type: ColorType.Solid, color: '#111827' },
      textColor: '#9ca3af',
    },
    grid: {
      vertLines: { color: '#374151' },
      horzLines: { color: '#374151' },
    },
    timeScale: {
      borderColor: '#374151',
      timeVisible: true,
      rightOffset: 5,
      barSpacing: 4,
      minBarSpacing: 0.5,
    },
    rightPriceScale: {
      borderColor: '#374151',
      autoScale: true,
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true },
  });
  
  // Historical line (gray)
  const histSeries = aiProjectionChart.addSeries(LineSeries, {
    color: '#9ca3af',
    lineWidth: 2,
  });
  histSeries.setData(historicalCandles.slice(-50).map(c => ({ time: c.time, value: c.close })));
  
  // Actual price line (bright green for what really happened)
  if (actualCandles.length > 0) {
    const actualSeries = aiProjectionChart.addSeries(LineSeries, {
      color: '#22c55e',
      lineWidth: 3,
    });
    actualSeries.setData(actualCandles.map(c => ({ time: c.time, value: c.close })));
  }
  
  // AI Projection line (blue dashed - what AI would have predicted)
  const lastHistTime = historicalCandles[historicalCandles.length - 1].time;
  const projectionData = [];
  let projPrice = startPrice;
  
  // Use seeded random for consistent results
  let seed = Math.floor(startPrice * 1000);
  const seededRandom = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  };
  
  // Projection based on AI direction with bounded random walk
  const totalDrift = aiDirection === 'Long' ? 0.05 : (aiDirection === 'Short' ? -0.05 : 0);
  const driftPerStep = totalDrift / Math.max(forecastCandles, 1);
  const volatility = 0.001;
  
  for (let i = 0; i <= Math.min(forecastCandles, actualCandles.length + 20); i++) {
    const time = lastHistTime + (i * intervalSeconds);
    projectionData.push({ time, value: projPrice });
    const step = driftPerStep + seededRandom() * volatility;
    projPrice = Math.max(startPrice * 0.9, Math.min(startPrice * 1.1, projPrice * (1 + step)));
  }
  
  const projSeries = aiProjectionChart.addSeries(LineSeries, {
    color: '#3b82f6',
    lineWidth: 2,
    lineStyle: LineStyle.Dashed,
  });
  projSeries.setData(projectionData);
  
  // Fit content
  aiProjectionChart.timeScale().fitContent();
}

function updateProjectionListView(expected, bullish, bearish, actualData = []) {
  console.log('updateProjectionListView called with:', { expectedLen: expected.length, bullishLen: bullish.length, bearishLen: bearish.length });
  
  const tbody = document.getElementById('projectionListBody');
  if (!tbody) {
    console.error('projectionListBody not found');
    return;
  }
  
  if (expected.length === 0) {
    console.warn('No expected data for list view');
    tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-gray-500">No projection data available</td></tr>';
    return;
  }
  
  // Only show first 100 rows in list for performance
  const displayData = expected.slice(0, 100);
  
  tbody.innerHTML = displayData.map((exp, i) => {
    const bull = bullish[i] || {};
    const bear = bearish[i] || {};
    const time = new Date(exp.time * 1000).toLocaleString();
    
    // Find actual price for this time if available
    const actual = actualData.find(a => Math.abs(a.time - exp.time) < 300);
    let actualStr = '--';
    let accStr = '--';
    let accClass = 'text-gray-400';
    
    if (actual) {
      actualStr = `$${actual.close.toFixed(4)}`;
      const deviation = Math.abs((actual.close - exp.value) / exp.value * 100);
      const accuracy = Math.max(0, 100 - deviation * 10);
      accStr = `${accuracy.toFixed(1)}%`;
      accClass = accuracy >= 80 ? 'text-green-600 font-medium' : 
                 accuracy >= 60 ? 'text-yellow-600' : 'text-red-600';
    }
    
    return `
      <tr class="hover:bg-gray-100 dark:hover:bg-gray-700 text-sm">
        <td class="p-2 text-gray-600 dark:text-gray-400">${time}</td>
        <td class="p-2 font-medium text-blue-600">$${exp.value.toFixed(4)}</td>
        <td class="p-2 text-green-600">$${bull.value?.toFixed(4) || '--'}</td>
        <td class="p-2 text-red-600">$${bear.value?.toFixed(4) || '--'}</td>
        <td class="p-2 text-purple-600" id="actual_${i}">${actualStr}</td>
        <td class="p-2 ${accClass}" id="acc_${i}">${accStr}</td>
      </tr>
    `;
  }).join('');
  
  // Add row count info
  if (expected.length > 100) {
    const info = document.createElement('tr');
    info.innerHTML = `<td colspan="6" class="p-2 text-center text-gray-500 text-sm">Showing first 100 of ${expected.length} projections</td>`;
    tbody.appendChild(info);
  }
}

// Generate multi-timeframe predictions based on context
function generateMultiTimeframePredictions(result) {
  const context = result.context || {};
  const baseDirection = context.regime === 'Bullish' ? 'Long' : (context.regime === 'Bearish' ? 'Short' : 'Neutral');
  const baseConfidence = (context.confidence || 3) * 20;
  const volatility = context.volatility || 'Normal';
  
  const predictions = {};
  const timeframes = ['1s', '2s', '3s', '5s', '10s', '30s', '1m', '5m', '15m', '1h', '4h', '1d'];
  
  timeframes.forEach((tf, idx) => {
    // Shorter timeframes have more noise, longer have clearer trend
    const confAdjust = (idx - 1) * 5;
    let direction = baseDirection;
    let confidence = Math.min(95, Math.max(20, baseConfidence + confAdjust));
    
    // Higher timeframes may show different direction if market is ranging
    if (context.structure === 'Ranging' && idx >= 2) {
      direction = 'Range';
      confidence = Math.min(70, confidence);
    }
    
    // Generate price targets
    const volMult = volatility === 'High' ? 1.5 : (volatility === 'Low' ? 0.5 : 1);
    const basePct = (0.1 + (idx * 0.1)) * volMult;
    
    const targets = [];
    if (direction === 'Long') {
      targets.push({ change: +(basePct * 0.5).toFixed(2), probability: Math.round(confidence * 0.9), type: 'Primary' });
      targets.push({ change: +(basePct * 1.2).toFixed(2), probability: Math.round(confidence * 0.6), type: 'Stretch' });
      targets.push({ change: -(basePct * 0.3).toFixed(2), probability: Math.round(100 - confidence), type: 'Risk' });
    } else if (direction === 'Short') {
      targets.push({ change: -(basePct * 0.5).toFixed(2), probability: Math.round(confidence * 0.9), type: 'Primary' });
      targets.push({ change: -(basePct * 1.2).toFixed(2), probability: Math.round(confidence * 0.6), type: 'Stretch' });
      targets.push({ change: +(basePct * 0.3).toFixed(2), probability: Math.round(100 - confidence), type: 'Risk' });
    } else {
      targets.push({ change: +(basePct * 0.3).toFixed(2), probability: 45, type: 'Primary' });
      targets.push({ change: -(basePct * 0.3).toFixed(2), probability: 40, type: 'Stretch' });
      targets.push({ change: 0, probability: 55, type: 'Risk' });
    }
    
    predictions[tf] = {
      direction,
      confidence,
      targets
    };
  });
  
  return predictions;
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
    // Fetch current market data and AI memory in parallel
    const timeframe = '1h';
    const [marketDataRes, memoryRes] = await Promise.all([
      fetch(`/api/market-data/${symbol}/${timeframe}`),
      fetch(`/api/ai-memory/summary/${symbol}`)
    ]);
    
    const marketData = await marketDataRes.json();
    const memorySummary = await memoryRes.json();
    
    if (!marketData.candles || marketData.candles.length === 0) {
      throw new Error('No market data available');
    }
    
    // Call AI strategy endpoint with memory context
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
        candleCount: candlesToSend,
        aiMemory: memorySummary
      })
    });
    
    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error);
    }
    
    // Add market data to result for projection chart
    result.marketData = marketData.candles.slice(-30);
    
    // Generate multi-timeframe predictions if not provided by backend
    if (!result.predictions) {
      result.predictions = generateMultiTimeframePredictions(result);
    }
    
    // Store globally for timeframe switching
    window.lastAiResult = result;
    
    // Update UI with results
    updateAiStrategyUI(result);
    
    // Update AI Results tab components
    updateAiResultsForTimeframe(aiResultsTimeframe, result);
    
    // Save to history sidebar
    addToAiStrategyHistory(result, symbol);
    
    // Record prediction to AI brain memory (non-blocking)
    recordAiPrediction(symbol, result);
    
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

// Store AI strategy history (persisted to localStorage)
let aiStrategyHistory = [];

function loadAiStrategyHistoryFromStorage() {
  try {
    const stored = localStorage.getItem('aiStrategyHistory');
    if (stored) {
      aiStrategyHistory = JSON.parse(stored);
      updateAiStrategyHistorySidebar();
      
      // Auto-display latest result if available
      if (aiStrategyHistory.length > 0) {
        const latest = aiStrategyHistory[0];
        const result = {
          context: latest.context,
          hypotheses: latest.hypotheses,
          learning: latest.learning,
          predictions: latest.predictions,
          marketData: latest.marketData
        };
        
        // Generate predictions if not stored
        if (!result.predictions) {
          result.predictions = generateMultiTimeframePredictions(result);
        }
        
        // Store globally
        window.lastAiResult = result;
        
        updateAiStrategyUI(result);
        
        // Update AI Results tab components
        setTimeout(() => {
          updateAiResultsForTimeframe(aiResultsTimeframe, result);
        }, 100);
      }
    }
  } catch (e) {
    console.warn('Failed to load AI strategy history:', e);
  }
}

function saveAiStrategyHistoryToStorage() {
  try {
    localStorage.setItem('aiStrategyHistory', JSON.stringify(aiStrategyHistory));
  } catch (e) {
    console.warn('Failed to save AI strategy history:', e);
  }
}

function addToAiStrategyHistory(result, symbol) {
  const historyItem = {
    id: Date.now(),
    timestamp: new Date().toLocaleString(),
    symbol: symbol.toUpperCase(),
    context: result.context,
    hypotheses: result.hypotheses,
    learning: result.learning,
    predictions: result.predictions,
    marketData: result.marketData
  };
  
  aiStrategyHistory.unshift(historyItem);
  if (aiStrategyHistory.length > 20) aiStrategyHistory.pop(); // Keep last 20
  
  updateAiStrategyHistorySidebar();
  saveAiStrategyHistoryToStorage();
}

function updateAiStrategyHistorySidebar() {
  const container = document.getElementById('aiStrategyHistoryList');
  if (!container) return;
  
  if (aiStrategyHistory.length === 0) {
    container.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400 p-2">Run AI analysis to see results here</p>';
    return;
  }
  
  container.innerHTML = aiStrategyHistory.map((item, index) => `
    <div class="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors border border-transparent hover:border-purple-300 dark:hover:border-purple-600" onclick="loadAiStrategyFromHistory(${index})">
      <div class="flex items-center justify-between mb-1">
        <span class="font-medium text-sm text-gray-800 dark:text-white">${item.symbol}</span>
        <span class="text-xs text-gray-500 dark:text-gray-400">${item.context?.session || 'N/A'}</span>
      </div>
      <div class="text-xs text-gray-600 dark:text-gray-400 mb-2">${item.timestamp}</div>
      <div class="flex flex-wrap gap-1">
        ${(item.hypotheses || []).slice(0, 2).map(h => `
          <span class="px-1.5 py-0.5 text-xs ${h.direction === 'Long' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : h.direction === 'Short' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' : 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300'} rounded">${h.direction || 'N'}</span>
        `).join('')}
        <span class="px-1.5 py-0.5 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded">${item.context?.volatility || 'Normal'}</span>
      </div>
    </div>
  `).join('');
}

window.loadAiStrategyFromHistory = function(index) {
  const item = aiStrategyHistory[index];
  if (!item) return;
  
  // Build full result object
  const result = {
    context: item.context,
    hypotheses: item.hypotheses,
    learning: item.learning,
    predictions: item.predictions,
    marketData: item.marketData
  };
  
  // Generate predictions if not stored
  if (!result.predictions) {
    result.predictions = generateMultiTimeframePredictions(result);
  }
  
  // Store globally and cache to localStorage
  window.lastAiResult = result;
  cacheAiResults(result);
  
  // Re-display the stored result
  updateAiStrategyUI(result);
  
  // Update AI Results tab components
  updateAiResultsForTimeframe(aiResultsTimeframe, result);
  
  // Switch to AI Strategy tab if not already there
  const aiTradingTabBtn = document.getElementById('botAiTradingTabBtn');
  if (aiTradingTabBtn) aiTradingTabBtn.click();
};

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
  
  // Equity chart height slider
  const equityHeightSlider = document.getElementById('equityChartHeight');
  const equityHeightLabel = document.getElementById('equityChartHeightLabel');
  if (equityHeightSlider) {
    equityHeightSlider.addEventListener('input', () => {
      const height = equityHeightSlider.value;
      if (equityHeightLabel) equityHeightLabel.textContent = height;
      // Resize chart if it exists
      const container = document.getElementById('equityCurveChart');
      if (container && equityChart) {
        container.style.height = `${height}px`;
        equityChart.resize(container.clientWidth, parseInt(height));
      }
    });
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
    if (!candles || candles.length === 0) {
      if (statusEl) {
        statusEl.textContent = `Error: Unable to load market data for ${asset}`;
        statusEl.className = 'mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm';
      }
      return;
    }
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
    if (!candles || candles.length === 0) {
      if (statusEl) {
        statusEl.textContent = `Error: Unable to load market data for ${asset}`;
        statusEl.className = 'mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm';
      }
      return;
    }
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
    if (!candles || candles.length === 0) {
      if (statusEl) {
        statusEl.textContent = `Error: Unable to load market data for ${asset}`;
        statusEl.className = 'mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm';
      }
      return;
    }
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
  const chartHeight = parseInt(document.getElementById('equityChartHeight')?.value) || 256;
  
  // Update container height
  container.style.height = `${chartHeight}px`;
  
  equityChart = createChart(container, {
    width: container.clientWidth,
    height: chartHeight,
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

// ============ AI MEMORY SYSTEM ============

async function loadAiMemoryData() {
  const asset = document.getElementById('aiMemoryAsset')?.value || 'silver';
  
  try {
    // Load brain data, events, and correlations in parallel
    const [brainRes, eventsRes, correlationsRes] = await Promise.all([
      fetch(`/api/ai-memory/brain/${asset}`),
      fetch('/api/ai-memory/events'),
      fetch('/api/ai-memory/correlations')
    ]);
    
    const brain = await brainRes.json();
    const eventsData = await eventsRes.json();
    const correlations = await correlationsRes.json();
    
    // Update brain status display
    updateBrainStatusDisplay(brain);
    
    // Update pattern map visualization
    updatePatternMapDisplay(brain.learnedPatterns || []);
    
    // Update events archive
    updateEventsArchiveDisplay(eventsData.events || [], asset);
    
    // Update correlations
    updateCorrelationsDisplay(correlations.pairs || {});
    
  } catch (e) {
    console.error('Failed to load AI memory:', e);
  }
}

function updateBrainStatusDisplay(brain) {
  const accuracyEl = document.getElementById('brainAccuracy');
  const predictionsEl = document.getElementById('brainPredictions');
  const patternsEl = document.getElementById('brainPatterns');
  const confidenceEl = document.getElementById('brainConfidence');
  const lastUpdatedEl = document.getElementById('brainLastUpdated');
  const topPatternsEl = document.getElementById('brainTopPatterns');
  const recentMemoryEl = document.getElementById('brainRecentMemory');
  
  if (accuracyEl) accuracyEl.textContent = `${brain.accuracy || 0}%`;
  if (predictionsEl) predictionsEl.textContent = brain.totalPredictions || 0;
  if (patternsEl) patternsEl.textContent = brain.learnedPatterns?.length || 0;
  if (confidenceEl) confidenceEl.textContent = `${brain.confidenceLevel || 0}%`;
  
  if (lastUpdatedEl) {
    if (brain.lastUpdated) {
      const date = new Date(brain.lastUpdated);
      lastUpdatedEl.textContent = `Updated: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
    } else {
      lastUpdatedEl.textContent = 'Never updated';
    }
  }
  
  // Top patterns
  if (topPatternsEl) {
    const patterns = (brain.learnedPatterns || [])
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, 5);
    
    if (patterns.length === 0) {
      topPatternsEl.innerHTML = '<span class="text-xs text-gray-500 italic">No patterns learned yet</span>';
    } else {
      topPatternsEl.innerHTML = patterns.map(p => `
        <span class="px-2 py-1 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full">
          ${p.name} (${p.successRate.toFixed(0)}%)
        </span>
      `).join('');
    }
  }
  
  // Recent memory
  if (recentMemoryEl) {
    const memory = (brain.sessionMemory || []).slice(0, 5);
    
    if (memory.length === 0) {
      recentMemoryEl.innerHTML = '<span class="text-xs text-gray-500 italic">No predictions yet</span>';
    } else {
      recentMemoryEl.innerHTML = memory.map(m => {
        const date = new Date(m.timestamp);
        const icon = m.correct ? '✓' : '✗';
        const colorClass = m.correct ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
        return `
          <div class="flex items-center justify-between text-xs p-1.5 bg-gray-50 dark:bg-gray-800 rounded">
            <span class="text-gray-500">${date.toLocaleString()}</span>
            <span class="${colorClass} font-medium">${icon} ${m.prediction > 0 ? 'Long' : 'Short'} @ ${m.confidence?.toFixed(0) || '?'}%</span>
          </div>
        `;
      }).join('');
    }
  }
}

function updatePatternMapDisplay(patterns) {
  const gridEl = document.getElementById('patternMapGrid');
  const topPatternsEl = document.getElementById('topProfitablePatterns');
  const totalPnLEl = document.getElementById('patternTotalPnL');
  const avgWinRateEl = document.getElementById('patternAvgWinRate');
  const totalTradesEl = document.getElementById('patternTotalTrades');
  const bestSessionEl = document.getElementById('patternBestSession');
  
  if (!gridEl || !patterns || patterns.length === 0) {
    if (gridEl) gridEl.innerHTML = '<p class="text-xs text-gray-500 italic col-span-full text-center py-4">Run backtests or auto-optimize to build pattern data</p>';
    // Reset stats to avoid stale data when switching assets
    if (topPatternsEl) topPatternsEl.innerHTML = '<p class="text-xs text-gray-500 italic">No profitable patterns yet</p>';
    if (totalPnLEl) { totalPnLEl.textContent = '$0'; totalPnLEl.className = 'text-sm font-bold text-green-600'; }
    if (avgWinRateEl) avgWinRateEl.textContent = '0%';
    if (totalTradesEl) totalTradesEl.textContent = '0';
    if (bestSessionEl) bestSessionEl.textContent = '--';
    return;
  }
  
  // Parse patterns into structured data
  const sessions = ['asian', 'london', 'ny', 'other'];
  const directions = ['long', 'short'];
  const exitTypes = ['dynamic_tp', 'rsi_overbought', 'rsi_oversold', 'trailing', 'other'];
  
  // Group patterns by session, direction, exit type
  const patternMap = {};
  const sessionPnL = { asian: 0, london: 0, ny: 0, other: 0 };
  let totalPnL = 0;
  let totalOccurrences = 0;
  let weightedWinRate = 0;
  
  patterns.forEach(p => {
    const name = (p.name || '').toLowerCase();
    const pnl = p.totalPnL || 0;
    const occurrences = p.occurrences || 0;
    const winRate = p.successRate || 0;
    
    totalPnL += pnl;
    totalOccurrences += occurrences;
    weightedWinRate += winRate * occurrences;
    
    // Extract session
    let session = 'other';
    for (const s of sessions) {
      if (name.includes(s)) { session = s; break; }
    }
    sessionPnL[session] += pnl;
    
    // Extract direction
    let direction = 'long';
    if (name.includes('short')) direction = 'short';
    
    // Extract exit type
    let exitType = 'other';
    if (name.includes('dynamic_tp')) exitType = 'dynamic_tp';
    else if (name.includes('rsi_overbought')) exitType = 'rsi_overbought';
    else if (name.includes('rsi_oversold')) exitType = 'rsi_oversold';
    else if (name.includes('trailing')) exitType = 'trailing';
    
    const key = `${session}_${direction}_${exitType}`;
    if (!patternMap[key]) {
      patternMap[key] = { session, direction, exitType, pnl: 0, occurrences: 0, totalWins: 0, count: 0 };
    }
    patternMap[key].pnl += pnl;
    patternMap[key].occurrences += occurrences;
    // Weight wins by occurrences for accurate aggregation
    patternMap[key].totalWins += (winRate / 100) * occurrences;
    patternMap[key].count++;
  });
  
  // Calculate weighted win rates per cell
  Object.values(patternMap).forEach(p => {
    p.winRate = p.occurrences > 0 ? (p.totalWins / p.occurrences) * 100 : 0;
  });
  
  // Build heatmap grid
  const exitLabels = { dynamic_tp: 'Dynamic TP', rsi_overbought: 'RSI OB', rsi_oversold: 'RSI OS', trailing: 'Trail', other: 'Other' };
  const sessionLabels = { asian: 'Asian', london: 'London', ny: 'NY', other: 'Other' };
  
  let gridHtml = `
    <div class="grid grid-cols-6 gap-1 text-xs">
      <div class="font-medium text-gray-500 p-1"></div>
      ${exitTypes.map(e => `<div class="font-medium text-gray-500 text-center p-1">${exitLabels[e]}</div>`).join('')}
  `;
  
  sessions.forEach(session => {
    directions.forEach(direction => {
      const rowLabel = `${sessionLabels[session]} ${direction === 'long' ? '↑' : '↓'}`;
      gridHtml += `<div class="font-medium text-gray-600 dark:text-gray-400 p-1 flex items-center">${rowLabel}</div>`;
      
      exitTypes.forEach(exitType => {
        const key = `${session}_${direction}_${exitType}`;
        const data = patternMap[key];
        
        if (!data || data.occurrences === 0) {
          gridHtml += `<div class="bg-gray-100 dark:bg-gray-800 rounded p-2 text-center text-gray-400 cursor-default" title="No data">-</div>`;
        } else {
          // Color based on P/L
          let bgColor = 'bg-gray-200 dark:bg-gray-700';
          if (data.pnl > 0) {
            if (data.pnl > 10000) bgColor = 'bg-green-600 text-white';
            else if (data.pnl > 5000) bgColor = 'bg-green-500 text-white';
            else if (data.pnl > 1000) bgColor = 'bg-green-400';
            else bgColor = 'bg-green-200';
          } else if (data.pnl < 0) {
            if (data.pnl < -10000) bgColor = 'bg-red-600 text-white';
            else if (data.pnl < -5000) bgColor = 'bg-red-500 text-white';
            else if (data.pnl < -1000) bgColor = 'bg-red-400';
            else bgColor = 'bg-red-200';
          }
          
          const tooltip = `${sessionLabels[session]} ${direction.toUpperCase()} - ${exitLabels[exitType]}\\nP/L: $${data.pnl.toFixed(2)}\\nTrades: ${data.occurrences}\\nWin Rate: ${data.winRate.toFixed(0)}%`;
          gridHtml += `<div class="${bgColor} rounded p-2 text-center cursor-pointer hover:opacity-80 transition-opacity" title="${tooltip}">
            <div class="font-bold">${data.pnl >= 0 ? '+' : ''}${(data.pnl / 1000).toFixed(1)}k</div>
            <div class="text-xs opacity-75">${data.occurrences}</div>
          </div>`;
        }
      });
    });
  });
  
  gridHtml += '</div>';
  gridEl.innerHTML = gridHtml;
  
  // Store all patterns for View All popup
  window._allPatterns = [...patterns].sort((a, b) => (b.totalPnL || 0) - (a.totalPnL || 0));
  
  // Top 10 profitable patterns
  const sortedPatterns = [...patterns]
    .filter(p => (p.totalPnL || 0) > 0)
    .sort((a, b) => (b.totalPnL || 0) - (a.totalPnL || 0))
    .slice(0, 10);
  
  if (topPatternsEl) {
    if (sortedPatterns.length === 0) {
      topPatternsEl.innerHTML = '<p class="text-xs text-gray-500 italic">No profitable patterns yet</p>';
    } else {
      topPatternsEl.innerHTML = sortedPatterns.map((p, i) => {
        const pnl = p.totalPnL || 0;
        const winRate = p.successRate || 0;
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '📊';
        const patternData = JSON.stringify(p).replace(/"/g, '&quot;');
        return `
          <div class="p-2 bg-gray-50 dark:bg-gray-800 rounded pattern-card" data-pattern='${patternData}'>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span>${medal}</span>
                <span class="text-xs font-medium text-gray-700 dark:text-gray-300">${p.name}</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-500">${p.occurrences || 0} trades</span>
                <span class="text-xs ${winRate >= 60 ? 'text-green-600' : 'text-gray-600'}">${winRate.toFixed(0)}%</span>
                <span class="text-sm font-bold ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</span>
                <button class="expand-pattern-btn px-1.5 py-0.5 text-xs bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded transition-colors" title="View details">▼</button>
              </div>
            </div>
            <div class="pattern-details hidden mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-xs">
              <div class="grid grid-cols-2 gap-2 mb-2">
                <div><span class="text-gray-500">First Seen:</span> <span class="text-gray-700 dark:text-gray-300">${p.firstSeen ? new Date(p.firstSeen).toLocaleDateString() : 'N/A'}</span></div>
                <div><span class="text-gray-500">Last Seen:</span> <span class="text-gray-700 dark:text-gray-300">${p.lastSeen ? new Date(p.lastSeen).toLocaleDateString() : 'N/A'}</span></div>
                <div><span class="text-gray-500">Total P/L:</span> <span class="${pnl >= 0 ? 'text-green-600' : 'text-red-600'} font-medium">$${pnl.toFixed(2)}</span></div>
                <div><span class="text-gray-500">Win Rate:</span> <span class="${winRate >= 60 ? 'text-green-600' : 'text-gray-700 dark:text-gray-300'}">${winRate.toFixed(1)}%</span></div>
                <div><span class="text-gray-500">Occurrences:</span> <span class="text-gray-700 dark:text-gray-300">${p.occurrences || 0}</span></div>
                <div><span class="text-gray-500">Avg P/L:</span> <span class="text-gray-700 dark:text-gray-300">$${((pnl) / (p.occurrences || 1)).toFixed(2)}</span></div>
              </div>
              <button class="copy-pattern-btn w-full px-2 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors flex items-center justify-center gap-1">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                Copy Pattern Settings
              </button>
            </div>
          </div>
        `;
      }).join('');
      
      // Add expand/collapse handlers
      topPatternsEl.querySelectorAll('.expand-pattern-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const card = btn.closest('.pattern-card');
          const details = card.querySelector('.pattern-details');
          const isHidden = details.classList.contains('hidden');
          details.classList.toggle('hidden');
          btn.textContent = isHidden ? '▲' : '▼';
        });
      });
      
      // Add copy handlers
      topPatternsEl.querySelectorAll('.copy-pattern-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const card = btn.closest('.pattern-card');
          const patternData = JSON.parse(card.dataset.pattern.replace(/&quot;/g, '"'));
          const settings = `Pattern: ${patternData.name}\nP/L: $${(patternData.totalPnL || 0).toFixed(2)}\nWin Rate: ${(patternData.successRate || 0).toFixed(1)}%\nTrades: ${patternData.occurrences || 0}\nFirst Seen: ${patternData.firstSeen || 'N/A'}\nLast Seen: ${patternData.lastSeen || 'N/A'}`;
          navigator.clipboard.writeText(settings).then(() => {
            btn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Copied!';
            setTimeout(() => {
              btn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg> Copy Pattern Settings';
            }, 1500);
          });
        });
      });
    }
  }
  
  // Summary stats
  const avgWinRate = totalOccurrences > 0 ? weightedWinRate / totalOccurrences : 0;
  const bestSession = Object.entries(sessionPnL).sort((a, b) => b[1] - a[1])[0];
  
  if (totalPnLEl) totalPnLEl.textContent = `$${totalPnL.toFixed(0)}`;
  if (totalPnLEl) totalPnLEl.className = `text-sm font-bold ${totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`;
  if (avgWinRateEl) avgWinRateEl.textContent = `${avgWinRate.toFixed(0)}%`;
  if (totalTradesEl) totalTradesEl.textContent = totalOccurrences.toString();
  if (bestSessionEl) bestSessionEl.textContent = sessionLabels[bestSession[0]] || '--';
}

function showAllPatternsModal(sortBy = 'pnl') {
  const patterns = window._allPatterns || [];
  if (patterns.length === 0) {
    alert('No patterns available');
    return;
  }
  
  // Sort patterns based on option
  let sorted = [...patterns];
  switch (sortBy) {
    case 'pnl': sorted.sort((a, b) => (b.totalPnL || 0) - (a.totalPnL || 0)); break;
    case 'winrate': sorted.sort((a, b) => (b.successRate || 0) - (a.successRate || 0)); break;
    case 'trades': sorted.sort((a, b) => (b.occurrences || 0) - (a.occurrences || 0)); break;
    case 'name': sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '')); break;
    case 'recent': sorted.sort((a, b) => new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0)); break;
  }
  
  const modal = document.createElement('div');
  modal.id = 'allPatternsModal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
  
  const patternsHtml = sorted.map((p, i) => {
    const pnl = p.totalPnL || 0;
    const winRate = p.successRate || 0;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
    const patternData = JSON.stringify(p).replace(/"/g, '&quot;');
    return `
      <div class="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg pattern-card-modal" data-pattern='${patternData}'>
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="text-sm">${medal}</span>
            <span class="text-sm font-medium text-gray-800 dark:text-white">${p.name}</span>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs text-gray-500">${p.occurrences || 0} trades</span>
            <span class="text-xs px-2 py-0.5 rounded ${winRate >= 60 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300'}">${winRate.toFixed(0)}% win</span>
            <span class="text-sm font-bold ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</span>
          </div>
        </div>
        <div class="grid grid-cols-4 gap-2 text-xs text-gray-500 dark:text-gray-400 mb-2">
          <div>First: ${p.firstSeen ? new Date(p.firstSeen).toLocaleDateString() : 'N/A'}</div>
          <div>Last: ${p.lastSeen ? new Date(p.lastSeen).toLocaleDateString() : 'N/A'}</div>
          <div>Avg: $${((pnl) / (p.occurrences || 1)).toFixed(2)}/trade</div>
          <div class="text-right">
            <button class="copy-modal-btn px-2 py-0.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs transition-colors">Copy</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-4xl mx-4 shadow-xl max-h-[85vh] flex flex-col">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-semibold text-gray-800 dark:text-white">All Patterns (${patterns.length})</h3>
        <div class="flex items-center gap-2">
          <label class="text-xs text-gray-500">Sort by:</label>
          <select id="patternSortSelect" class="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded">
            <option value="pnl" ${sortBy === 'pnl' ? 'selected' : ''}>P/L (High to Low)</option>
            <option value="winrate" ${sortBy === 'winrate' ? 'selected' : ''}>Win Rate</option>
            <option value="trades" ${sortBy === 'trades' ? 'selected' : ''}>Trade Count</option>
            <option value="name" ${sortBy === 'name' ? 'selected' : ''}>Name (A-Z)</option>
            <option value="recent" ${sortBy === 'recent' ? 'selected' : ''}>Most Recent</option>
          </select>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto space-y-2 pr-2">
        ${patternsHtml}
      </div>
      <div class="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <button id="closeAllPatternsBtn" class="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded-lg transition-colors">Close</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close button
  document.getElementById('closeAllPatternsBtn')?.addEventListener('click', () => modal.remove());
  
  // Sort change
  document.getElementById('patternSortSelect')?.addEventListener('change', (e) => {
    modal.remove();
    showAllPatternsModal(e.target.value);
  });
  
  // Copy buttons
  modal.querySelectorAll('.copy-modal-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.pattern-card-modal');
      const patternData = JSON.parse(card.dataset.pattern.replace(/&quot;/g, '"'));
      const settings = `Pattern: ${patternData.name}\nP/L: $${(patternData.totalPnL || 0).toFixed(2)}\nWin Rate: ${(patternData.successRate || 0).toFixed(1)}%\nTrades: ${patternData.occurrences || 0}\nAvg P/L: $${((patternData.totalPnL || 0) / (patternData.occurrences || 1)).toFixed(2)}\nFirst Seen: ${patternData.firstSeen || 'N/A'}\nLast Seen: ${patternData.lastSeen || 'N/A'}`;
      navigator.clipboard.writeText(settings).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      });
    });
  });
  
  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

// View All Patterns button listener
document.getElementById('viewAllPatternsBtn')?.addEventListener('click', () => showAllPatternsModal());

function updateEventsArchiveDisplay(events, selectedAsset) {
  const container = document.getElementById('eventsArchive');
  if (!container) return;
  
  // Filter events relevant to selected asset
  const relevantEvents = events.filter(e => 
    e.affectedAssets?.some(a => a.symbol?.toLowerCase() === selectedAsset.toLowerCase()) || 
    e.affectedAssets?.length === 0
  );
  
  if (relevantEvents.length === 0) {
    container.innerHTML = '<p class="text-sm text-gray-500 italic p-4">No events archived yet</p>';
    return;
  }
  
  const categoryColors = {
    'central-bank': 'border-blue-500',
    'economic-data': 'border-green-500',
    'geopolitical': 'border-red-500',
    'supply-demand': 'border-yellow-500',
    'technical': 'border-purple-500',
    'sentiment': 'border-pink-500'
  };
  
  container.innerHTML = relevantEvents.map(e => {
    const borderColor = categoryColors[e.category] || 'border-gray-400';
    const date = new Date(e.date);
    const assetChanges = (e.affectedAssets || []).map(a => {
      const change = a.percentChange24h || a.percentChange1h || 0;
      const colorClass = change >= 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
      return `<span class="px-2 py-0.5 text-xs ${colorClass} rounded">${a.symbol} ${change >= 0 ? '+' : ''}${change.toFixed(2)}%</span>`;
    }).join('');
    
    return `
      <div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border-l-4 ${borderColor}" data-event-id="${e.id}">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-medium text-blue-600 dark:text-blue-400 capitalize">${e.category?.replace('-', ' ') || 'General'}</span>
          <span class="text-xs text-gray-500">${date.toLocaleDateString()}</span>
        </div>
        <h5 class="text-sm font-medium text-gray-800 dark:text-white mb-1">${e.title}</h5>
        <p class="text-xs text-gray-600 dark:text-gray-400 mb-2">${e.description || ''}</p>
        <div class="flex items-center gap-2 flex-wrap">${assetChanges}</div>
        ${e.aiConclusion ? `<p class="text-xs text-purple-600 dark:text-purple-400 mt-2 italic">AI: ${e.aiConclusion}</p>` : ''}
      </div>
    `;
  }).join('');
}

function updateCorrelationsDisplay(pairs) {
  const goldSilverEl = document.getElementById('goldSilverRatio');
  const goldSp500El = document.getElementById('goldSp500Ratio');
  
  if (goldSilverEl && pairs['gold-silver']) {
    goldSilverEl.textContent = pairs['gold-silver'].currentRatio?.toFixed(2) || '--';
  }
  
  if (goldSp500El && pairs['gold-sp500']) {
    goldSp500El.textContent = pairs['gold-sp500'].currentRatio?.toFixed(2) || '--';
  }
}

function setupAiMemoryEventListeners() {
  // Asset selector
  const assetSelect = document.getElementById('aiMemoryAsset');
  if (assetSelect) {
    assetSelect.addEventListener('change', loadAiMemoryData);
  }
  
  // Refresh button
  const refreshBtn = document.getElementById('refreshAiMemory');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadAiMemoryData);
  }
  
  // Update correlations button
  const updateCorrelationsBtn = document.getElementById('updateCorrelations');
  if (updateCorrelationsBtn) {
    updateCorrelationsBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/ai-memory/correlations/gold-silver', { method: 'POST' });
        loadAiMemoryData();
      } catch (e) {
        console.error('Failed to update correlations:', e);
      }
    });
  }
  
  // Add new event button
  const addEventBtn = document.getElementById('addNewEvent');
  if (addEventBtn) {
    addEventBtn.addEventListener('click', showAddEventModal);
  }
  
  // Check Online news button
  const checkOnlineBtn = document.getElementById('checkOnlineNews');
  if (checkOnlineBtn) {
    checkOnlineBtn.addEventListener('click', checkOnlineMarketNews);
  }
  
  // Check Daily checkbox - load preference and set up listener
  const checkDailyCheckbox = document.getElementById('checkDailyNews');
  if (checkDailyCheckbox) {
    const savedPref = localStorage.getItem('checkDailyNews') === 'true';
    checkDailyCheckbox.checked = savedPref;
    checkDailyCheckbox.addEventListener('change', (e) => {
      localStorage.setItem('checkDailyNews', e.target.checked);
      if (e.target.checked) {
        checkDailyNewsOnLoad();
      }
    });
    // Auto-check on load if enabled
    if (savedPref) {
      setTimeout(() => checkDailyNewsOnLoad(), 1000);
    }
  }
  
  // Observe toggle button
  const observeToggle = document.getElementById('observeToggle');
  if (observeToggle) {
    observeToggle.addEventListener('click', toggleObserveMode);
  }
}

function showAddEventModal() {
  const modal = document.createElement('div');
  modal.id = 'addEventModal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
      <h3 class="text-lg font-semibold text-gray-800 dark:text-white mb-4">Add Market Event</h3>
      
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Event Title</label>
          <input type="text" id="eventTitle" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="e.g., Fed Rate Decision">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label>
          <input type="datetime-local" id="eventDate" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
          <select id="eventCategory" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            <option value="central-bank">Central Bank</option>
            <option value="economic-data">Economic Data</option>
            <option value="geopolitical">Geopolitical</option>
            <option value="supply-demand">Supply/Demand</option>
            <option value="technical">Technical</option>
            <option value="sentiment">Sentiment</option>
          </select>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
          <textarea id="eventDescription" rows="3" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="What happened..."></textarea>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tags (comma-separated)</label>
          <input type="text" id="eventTags" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="e.g., fed, rates, dovish">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">AI Conclusion (optional)</label>
          <textarea id="eventAiConclusion" rows="2" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="What the AI should learn from this..."></textarea>
        </div>
      </div>
      
      <div class="flex justify-end gap-3 mt-6">
        <button id="cancelEventBtn" class="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">Cancel</button>
        <button id="saveEventBtn" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors">Save Event</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Set default date to now
  const dateInput = document.getElementById('eventDate');
  if (dateInput) {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dateInput.value = now.toISOString().slice(0, 16);
  }
  
  // Event listeners
  document.getElementById('cancelEventBtn').addEventListener('click', () => modal.remove());
  document.getElementById('saveEventBtn').addEventListener('click', saveNewEvent);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

async function recordAiPrediction(symbol, result) {
  try {
    // Extract prediction direction and confidence from AI result
    const hypotheses = result.hypotheses || [];
    const mainHypothesis = hypotheses[0] || {};
    const direction = mainHypothesis.direction;
    const confidence = mainHypothesis.confidence === 'High' ? 85 : 
                       mainHypothesis.confidence === 'Medium' ? 65 : 45;
    
    // Prediction value: positive for Long, negative for Short
    const prediction = direction === 'Long' ? 1 : (direction === 'Short' ? -1 : 0);
    
    // Extract pattern names from tags/strategies
    const patterns = hypotheses.map(h => ({
      name: h.name || 'Unknown Pattern',
      success: true // Will be updated later when we verify
    }));
    
    // Record to brain (we don't have actual outcome yet, so store with null actual)
    await fetch('/api/ai-memory/brain/prediction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset: symbol,
        prediction,
        actual: prediction, // For now, assume correct until verified
        confidence,
        patterns
      })
    });
    
    console.log('Prediction recorded to AI brain:', { symbol, direction, confidence });
  } catch (e) {
    console.error('Failed to record prediction:', e);
  }
}

async function saveNewEvent() {
  const title = document.getElementById('eventTitle')?.value;
  const date = document.getElementById('eventDate')?.value;
  const category = document.getElementById('eventCategory')?.value;
  const description = document.getElementById('eventDescription')?.value;
  const tags = document.getElementById('eventTags')?.value?.split(',').map(t => t.trim()).filter(t => t);
  const aiConclusion = document.getElementById('eventAiConclusion')?.value;
  
  if (!title) {
    alert('Please enter an event title');
    return;
  }
  
  try {
    const response = await fetch('/api/ai-memory/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
        category,
        description,
        tags,
        aiConclusion,
        affectedAssets: []
      })
    });
    
    if (response.ok) {
      document.getElementById('addEventModal')?.remove();
      loadAiMemoryData();
    } else {
      alert('Failed to save event');
    }
  } catch (e) {
    console.error('Error saving event:', e);
    alert('Failed to save event');
  }
}

// ===== OBSERVE MODE =====
let observeInterval = null;
let observing = false;

function toggleObserveMode() {
  const btn = document.getElementById('observeToggle');
  const label = document.getElementById('observeLabel');
  
  if (observing) {
    // Stop observing
    observing = false;
    if (observeInterval) {
      clearInterval(observeInterval);
      observeInterval = null;
    }
    if (btn) {
      btn.classList.remove('bg-green-500', 'text-white', 'animate-pulse');
      btn.classList.add('bg-gray-200', 'dark:bg-gray-600', 'text-gray-700', 'dark:text-gray-300');
    }
    if (label) label.textContent = 'Observe';
    console.log('Observe mode stopped');
  } else {
    // Start observing
    observing = true;
    if (btn) {
      btn.classList.remove('bg-gray-200', 'dark:bg-gray-600', 'text-gray-700', 'dark:text-gray-300');
      btn.classList.add('bg-green-500', 'text-white', 'animate-pulse');
    }
    if (label) label.textContent = 'Observing...';
    console.log('Observe mode started');
    
    // Run immediately
    runObservation();
    
    // Then every 30 seconds
    observeInterval = setInterval(runObservation, 30000);
  }
}

// Store pending predictions to verify later
let pendingPredictions = [];

async function runObservation() {
  if (!observing) return;
  
  const asset = document.getElementById('aiMemoryAsset')?.value || 'silver';
  const symbol = asset === 'silver' ? 'XAGUSD' : 'XAUUSD';
  
  try {
    // Fetch current price data
    const response = await fetch(`/api/market-data/${asset}/1m`);
    if (!response.ok) throw new Error('Failed to fetch market data');
    
    const data = await response.json();
    if (!data.candles || data.candles.length < 30) return;
    
    const candles = data.candles.slice(-30); // Last 30 candles
    const latest = candles[candles.length - 1];
    const currentPrice = latest.close;
    const currentTime = Date.now();
    
    // First, verify any pending predictions that are now old enough
    const verifiedPredictions = [];
    const stillPending = [];
    
    for (const pred of pendingPredictions) {
      // Check predictions after 5 minutes (10 observation cycles)
      if (currentTime - pred.timestamp > 5 * 60 * 1000) {
        const priceChange = currentPrice - pred.priceAtPrediction;
        const actualDirection = priceChange > 0 ? 1 : (priceChange < 0 ? -1 : 0);
        const wasCorrect = pred.prediction === actualDirection;
        
        // Record verified prediction to brain
        await fetch('/api/ai-memory/brain/prediction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asset: symbol,
            prediction: pred.prediction,
            actual: actualDirection,
            confidence: pred.confidence,
            patterns: pred.patterns.map(p => ({ name: p.name, success: wasCorrect }))
          })
        });
        
        console.log('Verified prediction:', { 
          predicted: pred.prediction > 0 ? 'UP' : 'DOWN', 
          actual: actualDirection > 0 ? 'UP' : 'DOWN',
          correct: wasCorrect,
          priceChange: priceChange.toFixed(4)
        });
        
        verifiedPredictions.push(pred);
      } else {
        stillPending.push(pred);
      }
    }
    pendingPredictions = stillPending;
    
    // Make a new prediction using multi-timeframe analysis
    const patterns = detectAdvancedPatterns(candles);
    const directionalPatterns = patterns.filter(p => p.direction === 'up' || p.direction === 'down');
    
    if (directionalPatterns.length > 0) {
      // Calculate weighted prediction from all patterns
      let upWeight = 0, downWeight = 0;
      directionalPatterns.forEach(p => {
        if (p.direction === 'up') upWeight += p.strength;
        else if (p.direction === 'down') downWeight += p.strength;
      });
      
      const predictedDirection = upWeight > downWeight ? 1 : -1;
      const confidence = Math.max(upWeight, downWeight) / (upWeight + downWeight) * 100;
      
      // Store prediction to verify later
      pendingPredictions.push({
        timestamp: currentTime,
        priceAtPrediction: currentPrice,
        prediction: predictedDirection,
        confidence,
        patterns: directionalPatterns
      });
      
      console.log('New prediction:', { 
        direction: predictedDirection > 0 ? 'UP' : 'DOWN', 
        confidence: confidence.toFixed(1) + '%',
        patterns: directionalPatterns.map(p => p.name),
        pendingCount: pendingPredictions.length
      });
    }
    
    // Update last updated timestamp
    const lastUpdated = document.getElementById('brainLastUpdated');
    if (lastUpdated) {
      const pendingInfo = pendingPredictions.length > 0 ? ` (${pendingPredictions.length} pending)` : '';
      lastUpdated.textContent = `Observing: ${new Date().toLocaleTimeString()}${pendingInfo}`;
    }
    
    // Refresh brain stats if we verified any predictions
    if (verifiedPredictions.length > 0) {
      loadAiMemoryData();
    }
    
  } catch (e) {
    console.error('Observation error:', e);
  }
}

// Advanced pattern detection with multi-timeframe indicators
function detectAdvancedPatterns(candles) {
  const patterns = [];
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const n = closes.length;
  
  // Short-term indicators (last 5-10 candles)
  const sma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const sma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, closes.length);
  
  // Calculate EMA
  const calcEMA = (data, period) => {
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  };
  
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  
  // RSI calculation
  let gains = 0, losses = 0;
  for (let i = n - 14; i < n; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  
  // MACD
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, Math.min(26, closes.length));
  const macd = ema12 - ema26;
  
  // Price momentum
  const momentum = (closes[n-1] - closes[n-5]) / closes[n-5] * 100;
  const longMomentum = (closes[n-1] - closes[n-20]) / closes[n-20] * 100;
  
  // Wave detection - find recent swing highs/lows
  const recentHigh = Math.max(...highs.slice(-10));
  const recentLow = Math.min(...lows.slice(-10));
  const currentPrice = closes[n-1];
  const priceRange = recentHigh - recentLow;
  const positionInRange = priceRange > 0 ? (currentPrice - recentLow) / priceRange : 0.5;
  
  // Trend detection based on multiple indicators
  // SMA crossover
  if (sma5 > sma10 && sma10 > sma20) {
    patterns.push({ name: 'Strong uptrend (SMA alignment)', direction: 'up', strength: 75 });
  } else if (sma5 < sma10 && sma10 < sma20) {
    patterns.push({ name: 'Strong downtrend (SMA alignment)', direction: 'down', strength: 75 });
  } else if (sma5 > sma10) {
    patterns.push({ name: 'Uptrend (SMA5 > SMA10)', direction: 'up', strength: 55 });
  } else if (sma5 < sma10) {
    patterns.push({ name: 'Downtrend (SMA5 < SMA10)', direction: 'down', strength: 55 });
  }
  
  // EMA crossover
  if (ema9 > ema21) {
    patterns.push({ name: 'Bullish EMA crossover', direction: 'up', strength: 60 });
  } else {
    patterns.push({ name: 'Bearish EMA crossover', direction: 'down', strength: 60 });
  }
  
  // RSI signals
  if (rsi < 30) {
    patterns.push({ name: 'Oversold (RSI < 30)', direction: 'up', strength: 70 });
  } else if (rsi > 70) {
    patterns.push({ name: 'Overbought (RSI > 70)', direction: 'down', strength: 70 });
  } else if (rsi < 40) {
    patterns.push({ name: 'Low RSI zone', direction: 'up', strength: 40 });
  } else if (rsi > 60) {
    patterns.push({ name: 'High RSI zone', direction: 'down', strength: 40 });
  }
  
  // MACD signal
  if (macd > 0) {
    patterns.push({ name: 'MACD bullish', direction: 'up', strength: 55 });
  } else {
    patterns.push({ name: 'MACD bearish', direction: 'down', strength: 55 });
  }
  
  // Momentum signal
  if (momentum > 0.5) {
    patterns.push({ name: `Strong momentum (+${momentum.toFixed(2)}%)`, direction: 'up', strength: 65 });
  } else if (momentum < -0.5) {
    patterns.push({ name: `Strong momentum (${momentum.toFixed(2)}%)`, direction: 'down', strength: 65 });
  }
  
  // Long-term momentum
  if (longMomentum > 2) {
    patterns.push({ name: 'Long-term uptrend', direction: 'up', strength: 50 });
  } else if (longMomentum < -2) {
    patterns.push({ name: 'Long-term downtrend', direction: 'down', strength: 50 });
  }
  
  // Wave position (mean reversion)
  if (positionInRange > 0.9) {
    patterns.push({ name: 'Near resistance (top of range)', direction: 'down', strength: 45 });
  } else if (positionInRange < 0.1) {
    patterns.push({ name: 'Near support (bottom of range)', direction: 'up', strength: 45 });
  }
  
  return patterns;
}

function detectPatterns(candles) {
  const patterns = [];
  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  
  // Calculate moving averages
  const closes = candles.map(c => c.close);
  const sma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const sma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  
  // Trend detection
  if (sma5 > sma10 * 1.001) {
    patterns.push({ name: 'Uptrend (SMA5 > SMA10)', direction: 'up', strength: 65 });
  } else if (sma5 < sma10 * 0.999) {
    patterns.push({ name: 'Downtrend (SMA5 < SMA10)', direction: 'down', strength: 65 });
  }
  
  // Momentum
  const change = ((latest.close - prev.close) / prev.close) * 100;
  if (Math.abs(change) > 0.1) {
    const direction = change > 0 ? 'up' : 'down';
    patterns.push({ name: `Strong momentum (${change.toFixed(2)}%)`, direction, strength: 70 });
  }
  
  // Volatility spike
  const avgVolume = candles.slice(-10).reduce((a, c) => a + (c.volume || 0), 0) / 10;
  if (latest.volume > avgVolume * 1.5) {
    patterns.push({ name: 'Volume spike', direction: change > 0 ? 'up' : 'down', strength: 60 });
  }
  
  // Candlestick patterns
  const bodySize = Math.abs(latest.close - latest.open);
  const wickSize = latest.high - latest.low - bodySize;
  
  // Doji
  if (bodySize < wickSize * 0.1 && wickSize > 0) {
    patterns.push({ name: 'Doji (indecision)', direction: 'neutral', strength: 50 });
  }
  
  // Hammer / Inverted Hammer
  const lowerWick = Math.min(latest.open, latest.close) - latest.low;
  const upperWick = latest.high - Math.max(latest.open, latest.close);
  if (lowerWick > bodySize * 2 && upperWick < bodySize * 0.5) {
    patterns.push({ name: 'Hammer (bullish reversal)', direction: 'up', strength: 68 });
  }
  if (upperWick > bodySize * 2 && lowerWick < bodySize * 0.5) {
    patterns.push({ name: 'Shooting Star (bearish reversal)', direction: 'down', strength: 68 });
  }
  
  return patterns;
}

// ===== CHECK ONLINE NEWS =====
async function checkOnlineMarketNews() {
  const btn = document.getElementById('checkOnlineNews');
  const originalText = btn?.innerHTML;
  
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `
        <svg class="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
        </svg>
        Searching...
      `;
    }
    
    const response = await fetch('/api/ai-memory/fetch-news');
    if (!response.ok) throw new Error('Failed to fetch news');
    
    const data = await response.json();
    
    if (data.events && data.events.length > 0) {
      showNewsReviewModal(data.events);
    } else {
      alert('No significant market events found for today.');
    }
    
  } catch (e) {
    console.error('Error fetching news:', e);
    alert('Failed to fetch market news: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

function showNewsReviewModal(events) {
  const modal = document.createElement('div');
  modal.id = 'newsReviewModal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
  
  const eventsHtml = events.map((event, idx) => `
    <div class="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border-l-4 border-blue-500 mb-2">
      <label class="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked class="mt-1 w-4 h-4 text-purple-600 rounded" data-event-idx="${idx}">
        <div class="flex-1">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs font-medium text-blue-600 dark:text-blue-400">${event.category || 'Market'}</span>
            <span class="text-xs text-gray-500">${event.date || 'Today'}</span>
          </div>
          <h5 class="text-sm font-medium text-gray-800 dark:text-white mb-1">${event.title}</h5>
          <p class="text-xs text-gray-600 dark:text-gray-400">${event.description || ''}</p>
        </div>
      </label>
    </div>
  `).join('');
  
  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-2xl mx-4 shadow-xl max-h-[80vh] overflow-y-auto">
      <h3 class="text-lg font-semibold text-gray-800 dark:text-white mb-4">Found ${events.length} Market Events</h3>
      <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">Review and select events to add to your archive:</p>
      <div class="space-y-2 mb-4" id="foundEventsList">
        ${eventsHtml}
      </div>
      <div class="flex justify-end gap-2">
        <button id="cancelNewsBtn" class="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded-lg transition-colors">Cancel</button>
        <button id="addSelectedEventsBtn" class="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors">Add Selected</button>
      </div>
    </div>
  `;
  
  // Store events for later
  modal.dataset.events = JSON.stringify(events);
  document.body.appendChild(modal);
  
  // Attach event listeners after modal is in DOM
  document.getElementById('cancelNewsBtn')?.addEventListener('click', () => {
    document.getElementById('newsReviewModal')?.remove();
  });
  
  document.getElementById('addSelectedEventsBtn')?.addEventListener('click', () => {
    saveSelectedEvents();
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

async function saveSelectedEvents() {
  const modal = document.getElementById('newsReviewModal');
  if (!modal) return;
  
  const events = JSON.parse(modal.dataset.events || '[]');
  const checkboxes = modal.querySelectorAll('input[type="checkbox"]:checked');
  const selectedIndices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.eventIdx));
  
  let savedCount = 0;
  for (const idx of selectedIndices) {
    const event = events[idx];
    if (!event) continue;
    
    try {
      await fetch('/api/ai-memory/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: event.title,
          date: event.date || new Date().toISOString(),
          category: event.category || 'Market',
          description: event.description || '',
          tags: event.tags || [],
          aiConclusion: event.aiConclusion || '',
          affectedAssets: event.affectedAssets || []
        })
      });
      savedCount++;
    } catch (e) {
      console.error('Error saving event:', e);
    }
  }
  
  modal.remove();
  loadAiMemoryData();
  alert(`Added ${savedCount} events to archive.`);
}

// ===== CHECK DAILY ON LOAD =====
async function checkDailyNewsOnLoad() {
  const lastCheck = localStorage.getItem('lastDailyNewsCheck');
  const today = new Date().toDateString();
  
  if (lastCheck === today) {
    console.log('Daily news already checked today');
    return;
  }
  
  console.log('Running daily news check...');
  localStorage.setItem('lastDailyNewsCheck', today);
  
  // Wait for UI to be ready
  await new Promise(r => setTimeout(r, 2000));
  
  // Check for news
  await checkOnlineMarketNews();
}

// ===== AI TRADING ENGINE =====
const AI_TRADING = {
  active: false,
  interval: null,
  
  // Silver contract specifications
  contract: {
    minSize: 0.05,
    contractSizePerPoint: 100,
    onePointMeans: 0.01, // Cents/Troy Ounce
    valuePerPoint: 1, // AUD
    minStopDistance: 4,
    minGuaranteedStop: 40
  },
  
  // Trading state
  state: {
    capital: 2000,
    startingCapital: 2000,
    position: null, // { type: 'long'/'short', size: number, entryPrice: number, entryTime: Date }
    trades: [],
    pnl: 0,
    wins: 0,
    losses: 0
  },
  
  // Learning weights (adjusted based on success)
  learning: {
    score: 0,
    weights: {
      trend: 1.0,
      momentum: 1.0,
      rsi: 1.0,
      macd: 1.0,
      wavePosition: 1.0,
      news: 1.2,
      higherTF: 1.3
    },
    recentPatterns: []
  },
  
  // Market analysis cache
  analysis: {
    allTimeframes: {},
    newsSentiment: 'neutral',
    marketSpeed: 'normal',
    lastCheck: null
  }
};

// Initialize AI Trading UI
function initAiTrading() {
  const startBtn = document.getElementById('startAiTrading');
  const stopBtn = document.getElementById('stopAiTrading');
  const resetBtn = document.getElementById('resetAiTrading');
  
  if (startBtn) {
    startBtn.addEventListener('click', startAiTrading);
  }
  if (stopBtn) {
    stopBtn.addEventListener('click', stopAiTrading);
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', resetAiTrading);
  }
  
  // Load saved state
  loadAiTradingState();
  updateAiTradingUI();
  
  // Initialize AI Chat
  initAiChat();
}

// AI Chat state
const AI_CHAT = {
  messages: [],
  isLoading: false
};

// Initialize AI Chat handlers
function initAiChat() {
  const sendBtn = document.getElementById('sendAiChat');
  const clearBtn = document.getElementById('clearAiChat');
  const inputEl = document.getElementById('aiChatInput');
  
  if (sendBtn) {
    sendBtn.addEventListener('click', sendAiChatMessage);
  }
  
  if (clearBtn) {
    clearBtn.addEventListener('click', clearAiChat);
  }
  
  if (inputEl) {
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAiChatMessage();
      }
    });
  }
  
  // Load saved chat
  const saved = localStorage.getItem('aiChatMessages');
  if (saved) {
    try {
      AI_CHAT.messages = JSON.parse(saved);
      renderAiChatMessages();
    } catch (e) {}
  }
}

// Send message to AI
async function sendAiChatMessage() {
  const inputEl = document.getElementById('aiChatInput');
  const message = inputEl?.value?.trim();
  
  if (!message || AI_CHAT.isLoading) return;
  
  AI_CHAT.isLoading = true;
  inputEl.value = '';
  
  // Add user message
  AI_CHAT.messages.push({ role: 'user', content: message, time: Date.now() });
  renderAiChatMessages();
  
  // Show loading
  const loadingId = Date.now();
  AI_CHAT.messages.push({ role: 'assistant', content: '...', time: loadingId, loading: true });
  renderAiChatMessages();
  
  try {
    // Get current context
    const symbol = document.getElementById('aiSymbol')?.value || 'silver';
    const tf = aiResultsTimeframe || '5m';
    
    // Fetch brain data for context
    let brainData = null;
    try {
      const res = await fetch('/api/ai-memory/brain');
      if (res.ok) brainData = await res.json();
    } catch (e) {}
    
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        symbol,
        timeframe: tf,
        brainData,
        chatHistory: AI_CHAT.messages.slice(-10).filter(m => !m.loading)
      })
    });
    
    // Remove loading message
    AI_CHAT.messages = AI_CHAT.messages.filter(m => m.time !== loadingId);
    
    if (response.ok) {
      const data = await response.json();
      AI_CHAT.messages.push({ role: 'assistant', content: data.response, time: Date.now() });
    } else {
      AI_CHAT.messages.push({ role: 'assistant', content: 'Sorry, I had trouble processing that. Please try again.', time: Date.now() });
    }
  } catch (e) {
    AI_CHAT.messages = AI_CHAT.messages.filter(m => m.time !== loadingId);
    AI_CHAT.messages.push({ role: 'assistant', content: 'Connection error. Please try again.', time: Date.now() });
  }
  
  AI_CHAT.isLoading = false;
  saveAiChat();
  renderAiChatMessages();
}

// Render chat messages
function renderAiChatMessages() {
  const container = document.getElementById('aiChatMessages');
  if (!container) return;
  
  if (AI_CHAT.messages.length === 0) {
    container.innerHTML = '<div class="text-center text-xs text-gray-500 dark:text-gray-400 italic py-4">Ask me about trading strategies, market analysis, or discuss your ideas...</div>';
    return;
  }
  
  container.innerHTML = AI_CHAT.messages.map(msg => {
    if (msg.role === 'user') {
      return `<div class="flex justify-end"><div class="max-w-[80%] bg-purple-100 dark:bg-purple-900/50 text-gray-800 dark:text-gray-200 rounded-lg px-3 py-2 text-sm">${escapeHtml(msg.content)}</div></div>`;
    } else {
      const content = msg.loading 
        ? '<div class="flex gap-1"><span class="w-2 h-2 bg-purple-400 rounded-full animate-bounce"></span><span class="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style="animation-delay:0.1s"></span><span class="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style="animation-delay:0.2s"></span></div>'
        : formatAiResponse(msg.content);
      return `<div class="flex justify-start"><div class="max-w-[85%] bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg px-3 py-2 text-sm">${content}</div></div>`;
    }
  }).join('');
  
  container.scrollTop = container.scrollHeight;
}

// Format AI response with markdown-like parsing
function formatAiResponse(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-200 dark:bg-gray-600 px-1 rounded text-xs">$1</code>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Clear chat
function clearAiChat() {
  AI_CHAT.messages = [];
  localStorage.removeItem('aiChatMessages');
  renderAiChatMessages();
}

// Save chat to localStorage
function saveAiChat() {
  localStorage.setItem('aiChatMessages', JSON.stringify(AI_CHAT.messages.slice(-50)));
}

// Read settings from Capital & Fees section
function getTradeSettings() {
  return {
    initialCapital: parseFloat(document.getElementById('initialCapital')?.value) || 2000,
    maxPositionSize: parseFloat(document.getElementById('maxPositionSize')?.value) || 1,
    positionSize: parseFloat(document.getElementById('positionSize')?.value) || 0.5,
    minSize: parseFloat(document.getElementById('positionSize')?.value) || 0.05, // Alias for backtest
    useOrderFee: document.getElementById('useOrderFee')?.checked ?? true,
    orderFee: parseFloat(document.getElementById('orderFee')?.value) || 7,
    commission: parseFloat(document.getElementById('orderFee')?.value) || 7, // Alias for backtest
    useSpread: document.getElementById('useSpread')?.checked ?? true,
    spreadPips: parseFloat(document.getElementById('spreadPips')?.value) || 2,
    stopLoss: parseFloat(document.getElementById('stopLoss')?.value) || 7000,
    takeProfit: parseFloat(document.getElementById('takeProfit')?.value) || 0,
    tradeType: document.getElementById('tradeType')?.value || 'both'
  };
}

// Get backtest-specific trading settings from AI Trading panel
function getBacktestSettings() {
  return {
    capital: parseFloat(document.getElementById('backtestCapital')?.value) || 10000,
    initialCapital: parseFloat(document.getElementById('backtestCapital')?.value) || 10000,
    positionSize: parseFloat(document.getElementById('backtestPositionSize')?.value) || 1,
    minSize: parseFloat(document.getElementById('backtestPositionSize')?.value) || 1,
    maxSize: parseFloat(document.getElementById('backtestMaxSize')?.value) || 10,
    maxPositionSize: parseFloat(document.getElementById('backtestMaxSize')?.value) || 10,
    orderFee: parseFloat(document.getElementById('backtestOrderFee')?.value) || 2,
    commission: parseFloat(document.getElementById('backtestOrderFee')?.value) || 2,
    spread: parseFloat(document.getElementById('backtestSpread')?.value) || 0.02,
    spreadPips: parseFloat(document.getElementById('backtestSpread')?.value) || 0.02,
    cumulate: document.getElementById('backtestCumulate')?.checked ?? false,
    tradeType: document.getElementById('backtestTradeType')?.value || 'both',
    useOrderFee: true,
    useSpread: true
  };
}

// Start AI Trading
async function startAiTrading() {
  if (AI_TRADING.active) return;
  
  AI_TRADING.active = true;
  
  // Update UI
  document.getElementById('startAiTrading')?.classList.add('hidden');
  document.getElementById('stopAiTrading')?.classList.remove('hidden');
  document.getElementById('aiTradeStatus').textContent = 'Running';
  document.getElementById('aiTradeStatus').className = 'px-2 py-0.5 text-xs font-medium bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 rounded-full';
  
  // Initialize capital from settings if starting fresh
  if (AI_TRADING.state.trades.length === 0) {
    const settings = getTradeSettings();
    AI_TRADING.state.capital = settings.initialCapital;
    AI_TRADING.state.startingCapital = settings.initialCapital;
  }
  
  // Run immediately, then on interval
  await runAiTradingCycle();
  
  // Determine interval based on timeframe
  const tf = document.querySelector('#aiResultsTimeframeBtns .ai-tf-btn.bg-purple-100')?.dataset?.tf || '5m';
  AI_TRADING.currentTF = tf;
  AI_TRADING.baseIntervalMs = getTradeIntervalForTimeframe(tf);
  
  // Start with base interval, will be adjusted dynamically based on market speed
  scheduleNextTradeCycle();
  
  console.log('AI Trading started, base interval:', AI_TRADING.baseIntervalMs, 'ms');
}

// Schedule next trade cycle with dynamic interval based on market speed
function scheduleNextTradeCycle() {
  if (!AI_TRADING.active) return;
  
  // Adjust interval based on market speed
  const speedMultipliers = {
    'very-fast': 0.5,  // Trade twice as fast
    'fast': 0.75,
    'normal': 1.0,
    'slow': 1.5  // Trade slower in quiet markets
  };
  
  const multiplier = speedMultipliers[AI_TRADING.analysis.marketSpeed] || 1.0;
  const adjustedInterval = Math.floor(AI_TRADING.baseIntervalMs * multiplier);
  
  AI_TRADING.interval = setTimeout(async () => {
    await runAiTradingCycle();
    scheduleNextTradeCycle();  // Schedule next cycle with potentially new interval
  }, adjustedInterval);
  
  console.log(`Next trade cycle in ${adjustedInterval}ms (speed: ${AI_TRADING.analysis.marketSpeed})`);
}

// Get trade interval based on timeframe (market speed awareness)
function getTradeIntervalForTimeframe(tf) {
  const intervals = {
    '1s': 3000,    // 3 sec
    '2s': 5000,    // 5 sec
    '3s': 6000,    // 6 sec
    '5s': 10000,   // 10 sec
    '10s': 15000,  // 15 sec
    '30s': 30000,  // 30 sec
    '1m': 60000,   // 1 min
    '5m': 120000,  // 2 min
    '15m': 300000, // 5 min
    '1h': 600000,  // 10 min
    '4h': 900000,  // 15 min
    '1d': 1800000  // 30 min
  };
  return intervals[tf] || 60000;
}

// Stop AI Trading
function stopAiTrading() {
  AI_TRADING.active = false;
  
  if (AI_TRADING.interval) {
    clearTimeout(AI_TRADING.interval);
    AI_TRADING.interval = null;
  }
  
  // Close any open position
  if (AI_TRADING.state.position) {
    closePosition('Trading stopped');
  }
  
  document.getElementById('startAiTrading')?.classList.remove('hidden');
  document.getElementById('stopAiTrading')?.classList.add('hidden');
  document.getElementById('aiTradeStatus').textContent = 'Stopped';
  document.getElementById('aiTradeStatus').className = 'px-2 py-0.5 text-xs font-medium bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-full';
  
  // Hide signal
  document.getElementById('aiTradeSignal')?.classList.add('hidden');
  
  saveAiTradingState();
  console.log('AI Trading stopped');
}

// Reset AI Trading
function resetAiTrading() {
  stopAiTrading();
  
  const settings = getTradeSettings();
  
  AI_TRADING.state = {
    capital: settings.initialCapital,
    startingCapital: settings.initialCapital,
    position: null,
    trades: [],
    pnl: 0,
    wins: 0,
    losses: 0
  };
  
  AI_TRADING.learning = {
    score: 0,
    weights: {
      trend: 1.0,
      momentum: 1.0,
      rsi: 1.0,
      macd: 1.0,
      wavePosition: 1.0,
      news: 1.2,
      higherTF: 1.3
    },
    recentPatterns: []
  };
  
  saveAiTradingState();
  updateAiTradingUI();
  
  // Clear trade list
  const tradeList = document.getElementById('aiTradeList');
  if (tradeList) {
    tradeList.innerHTML = '<div class="p-3 text-center text-gray-500 dark:text-gray-400 italic">No trades yet - click Start to begin AI trading</div>';
  }
  
  console.log('AI Trading reset');
}

// Main trading cycle
async function runAiTradingCycle() {
  if (!AI_TRADING.active) return;
  
  try {
    const asset = document.getElementById('aiMemoryAsset')?.value || 'silver';
    const symbol = asset === 'silver' ? 'XAGUSD' : 'XAUUSD';
    const currentTF = document.querySelector('#aiResultsTimeframeBtns .ai-tf-btn.bg-purple-100')?.dataset?.tf || '5m';
    
    // 1. Fetch ALL timeframes for comprehensive analysis
    await fetchAllTimeframeData(symbol);
    
    // 2. Check news/breaking events (every 5 cycles to save resources)
    const cycleCount = AI_TRADING.state.trades.length;
    if (cycleCount % 5 === 0) {
      await checkMarketNews();
    }
    
    // 3. Calculate market speed based on volatility
    updateMarketSpeed();
    
    // 4. Run comprehensive analysis
    const decision = analyzeAndDecide(currentTF);
    
    // 5. Execute trade decision
    await executeTradeDecision(decision, symbol);
    
    // 6. Update UI
    updateAiTradingUI();
    
    // Update last check time
    document.getElementById('aiTradeLastCheck').textContent = `Last analysis: ${new Date().toLocaleTimeString()}`;
    
  } catch (e) {
    console.error('AI Trading cycle error:', e);
  }
}

// Fetch data from ALL timeframes
async function fetchAllTimeframeData(symbol) {
  const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];
  
  const fetchPromises = timeframes.map(async (tf) => {
    try {
      const response = await fetch(`/api/market-data/${symbol}/${tf}`);
      if (response.ok) {
        const data = await response.json();
        if (data.candles && data.candles.length > 0) {
          AI_TRADING.analysis.allTimeframes[tf] = {
            candles: data.candles,
            analysis: analyzeHistoricalData(data.candles),
            timestamp: Date.now()
          };
        }
      }
    } catch (e) {
      console.error(`Failed to fetch ${tf} data:`, e);
    }
  });
  
  await Promise.all(fetchPromises);
  console.log('All timeframes fetched:', Object.keys(AI_TRADING.analysis.allTimeframes));
}

// Check market news using AI
async function checkMarketNews() {
  try {
    const response = await fetch('/api/ai/check-breaking-news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset: 'silver' })
    });
    
    if (response.ok) {
      const data = await response.json();
      AI_TRADING.analysis.newsSentiment = data.sentiment || 'neutral';
      
      const sentimentEl = document.getElementById('aiNewsSentiment');
      if (sentimentEl) {
        const colors = {
          bullish: 'text-green-600 dark:text-green-400',
          bearish: 'text-red-600 dark:text-red-400',
          neutral: 'text-gray-600 dark:text-gray-400'
        };
        sentimentEl.textContent = data.sentiment?.charAt(0).toUpperCase() + data.sentiment?.slice(1) || 'Neutral';
        sentimentEl.className = `text-xs font-medium ${colors[data.sentiment] || colors.neutral}`;
      }
    }
  } catch (e) {
    // Fallback to neutral if news check fails
    AI_TRADING.analysis.newsSentiment = 'neutral';
  }
}

// Calculate market speed based on current volatility
function updateMarketSpeed() {
  const tf1m = AI_TRADING.analysis.allTimeframes['1m'];
  if (!tf1m || !tf1m.analysis) {
    AI_TRADING.analysis.marketSpeed = 'normal';
    return;
  }
  
  const volatility = tf1m.analysis.volatility || 0.01;
  
  let speed;
  if (volatility > 0.02) speed = 'very-fast';
  else if (volatility > 0.01) speed = 'fast';
  else if (volatility > 0.005) speed = 'normal';
  else speed = 'slow';
  
  AI_TRADING.analysis.marketSpeed = speed;
  
  const speedEl = document.getElementById('aiMarketSpeed');
  if (speedEl) {
    const colors = {
      'very-fast': 'text-red-600 dark:text-red-400 font-bold',
      'fast': 'text-orange-600 dark:text-orange-400',
      'normal': 'text-gray-600 dark:text-gray-400',
      'slow': 'text-blue-600 dark:text-blue-400'
    };
    speedEl.textContent = speed.replace('-', ' ').toUpperCase();
    speedEl.className = `text-xs font-medium ${colors[speed]}`;
  }
}

// Comprehensive analysis across all timeframes
function analyzeAndDecide(currentTF) {
  const weights = AI_TRADING.learning.weights;
  let bullScore = 0;
  let bearScore = 0;
  let confidence = 0;
  const reasons = [];
  
  // 1. Calculate separate local TF and higher TF trends, then blend 30/70
  const htfOrder = ['1d', '4h', '1h', '15m', '5m', '1m'];
  const currentIdx = htfOrder.indexOf(currentTF);
  
  let localTrend = 0;
  let higherTFTrend = 0;
  let higherTFCount = 0;
  
  for (let i = 0; i < htfOrder.length; i++) {
    const tf = htfOrder[i];
    const tfData = AI_TRADING.analysis.allTimeframes[tf];
    if (!tfData?.analysis) continue;
    
    const trend = tfData.analysis.trend || 0;
    const isHigher = i < currentIdx;
    
    if (tf === currentTF) {
      localTrend = trend;
    } else if (isHigher) {
      // Weight higher timeframes more heavily (longer = more weight)
      const htfWeight = 1 + (currentIdx - i) * 0.2;
      higherTFTrend += trend * htfWeight;
      higherTFCount += htfWeight;
      if (Math.abs(trend) > 0.2) {
        reasons.push(`${tf} ${trend > 0 ? 'uptrend' : 'downtrend'}`);
      }
    }
  }
  
  // Normalize higher TF trend
  if (higherTFCount > 0) {
    higherTFTrend = higherTFTrend / higherTFCount;
  }
  
  // Blend: 30% local + 70% higher TF (as per design spec)
  const blendedTrend = (localTrend * 0.3) + (higherTFTrend * 0.7);
  
  // Apply blended trend to scores
  if (blendedTrend > 0.1) {
    bullScore += blendedTrend * weights.trend;
    reasons.push(`Blended trend bullish (${(blendedTrend * 100).toFixed(0)}%)`);
  } else if (blendedTrend < -0.1) {
    bearScore += Math.abs(blendedTrend) * weights.trend;
    reasons.push(`Blended trend bearish (${(blendedTrend * 100).toFixed(0)}%)`);
  }
  
  // 2. Current timeframe indicators
  const currentData = AI_TRADING.analysis.allTimeframes[currentTF];
  if (currentData?.analysis) {
    const { indicators, waveInfo } = currentData.analysis;
    
    // RSI
    if (indicators?.rsi < 30) {
      bullScore += 0.5 * weights.rsi;
      reasons.push('RSI oversold');
    } else if (indicators?.rsi > 70) {
      bearScore += 0.5 * weights.rsi;
      reasons.push('RSI overbought');
    }
    
    // MACD
    if (indicators?.macd > 0) {
      bullScore += 0.3 * weights.macd;
    } else {
      bearScore += 0.3 * weights.macd;
    }
    
    // Wave position (mean reversion)
    if (waveInfo?.positionInCycle < 0.2) {
      bullScore += 0.4 * weights.wavePosition;
      reasons.push('Near support');
    } else if (waveInfo?.positionInCycle > 0.8) {
      bearScore += 0.4 * weights.wavePosition;
      reasons.push('Near resistance');
    }
  }
  
  // 3. News sentiment
  if (AI_TRADING.analysis.newsSentiment === 'bullish') {
    bullScore += 0.5 * weights.news;
    reasons.push('Bullish news');
  } else if (AI_TRADING.analysis.newsSentiment === 'bearish') {
    bearScore += 0.5 * weights.news;
    reasons.push('Bearish news');
  }
  
  // 4. Market speed adjustment (avoid trading in very fast markets unless confident)
  const speed = AI_TRADING.analysis.marketSpeed;
  const speedMultiplier = speed === 'very-fast' ? 0.7 : (speed === 'fast' ? 0.85 : 1);
  
  // Calculate final decision
  const totalScore = bullScore + bearScore;
  confidence = totalScore > 0 ? Math.abs(bullScore - bearScore) / totalScore * speedMultiplier : 0;
  
  let action = 'hold';
  const settings = getTradeSettings();
  
  // Decision thresholds (require minimum confidence)
  const minConfidence = 0.3;
  
  if (confidence > minConfidence) {
    if (bullScore > bearScore * 1.2 && (settings.tradeType === 'both' || settings.tradeType === 'long')) {
      action = 'buy';
    } else if (bearScore > bullScore * 1.2 && (settings.tradeType === 'both' || settings.tradeType === 'short')) {
      action = 'sell';
    }
  }
  
  // Check if we should close existing position
  if (AI_TRADING.state.position) {
    const pos = AI_TRADING.state.position;
    if (pos.type === 'long' && action === 'sell') action = 'close_and_sell';
    else if (pos.type === 'short' && action === 'buy') action = 'close_and_buy';
    else if (confidence < 0.15) action = 'close'; // Close on low confidence
  }
  
  return { action, confidence, bullScore, bearScore, reasons };
}

// Execute trade decision
async function executeTradeDecision(decision, symbol) {
  const { action, confidence, reasons } = decision;
  const settings = getTradeSettings();
  const signalEl = document.getElementById('aiTradeSignal');
  
  // Get current price
  const tf1m = AI_TRADING.analysis.allTimeframes['1m'];
  if (!tf1m?.candles?.length) return;
  
  const currentPrice = tf1m.candles[tf1m.candles.length - 1].close;
  
  // Show signal indicator
  if (action === 'buy' || action === 'close_and_buy') {
    showTradeSignal('BUY', 'bg-green-500');
  } else if (action === 'sell' || action === 'close_and_sell') {
    showTradeSignal('SELL', 'bg-red-500');
  } else if (action === 'close') {
    showTradeSignal('CLOSE', 'bg-yellow-500');
  } else {
    signalEl?.classList.add('hidden');
  }
  
  // Handle close actions first
  if (action.includes('close') && AI_TRADING.state.position) {
    await closePosition(reasons.join(', '));
  }
  
  // Open new position
  if ((action === 'buy' || action === 'close_and_buy') && !AI_TRADING.state.position) {
    openPosition('long', currentPrice, settings, confidence, reasons);
  } else if ((action === 'sell' || action === 'close_and_sell') && !AI_TRADING.state.position) {
    openPosition('short', currentPrice, settings, confidence, reasons);
  }
  
  // Check stop loss / take profit for existing position
  if (AI_TRADING.state.position) {
    checkStopLossTakeProfit(currentPrice, settings);
  }
}

// Show blinking trade signal and add marker to chart
function showTradeSignal(text, colorClass) {
  const signalEl = document.getElementById('aiTradeSignal');
  if (!signalEl) return;
  
  signalEl.textContent = text;
  signalEl.className = `px-3 py-1 text-xs font-bold text-white rounded-full animate-pulse ${colorClass}`;
  signalEl.classList.remove('hidden');
  
  // Add blinking animation with CSS
  signalEl.style.animation = 'none';
  signalEl.offsetHeight; // Trigger reflow
  signalEl.style.animation = 'pulse 0.5s ease-in-out 6';
  
  // Hide after 3 seconds
  setTimeout(() => {
    signalEl.classList.add('hidden');
  }, 3000);
  
  // Add marker to projection chart if available
  addTradeMarkerToChart(text);
}

// Add trade marker to the projection chart
function addTradeMarkerToChart(tradeType) {
  if (!aiProjectionChart) return;
  
  // Get current time for marker
  const tf1m = AI_TRADING.analysis.allTimeframes['1m'];
  if (!tf1m?.candles?.length) return;
  
  const lastCandle = tf1m.candles[tf1m.candles.length - 1];
  const markerTime = lastCandle.time;
  const price = lastCandle.close;
  
  // Store markers in AI_TRADING for persistence
  if (!AI_TRADING.chartMarkers) {
    AI_TRADING.chartMarkers = [];
  }
  
  const marker = {
    time: markerTime,
    position: tradeType === 'BUY' || tradeType === 'CLOSE' ? 'belowBar' : 'aboveBar',
    color: tradeType === 'BUY' ? '#22c55e' : (tradeType === 'SELL' ? '#ef4444' : '#eab308'),
    shape: tradeType === 'BUY' ? 'arrowUp' : (tradeType === 'SELL' ? 'arrowDown' : 'circle'),
    text: tradeType,
    size: 2
  };
  
  AI_TRADING.chartMarkers.push(marker);
  
  // Keep only last 50 markers
  if (AI_TRADING.chartMarkers.length > 50) {
    AI_TRADING.chartMarkers = AI_TRADING.chartMarkers.slice(-50);
  }
  
  // Try to add markers to the chart series
  try {
    // Find the historical series (first series) and add markers
    if (aiProjectionSeries && aiProjectionSeries.length > 0) {
      const historicalSeries = aiProjectionSeries[0];
      if (historicalSeries && typeof historicalSeries.setMarkers === 'function') {
        historicalSeries.setMarkers(AI_TRADING.chartMarkers);
      }
    }
  } catch (e) {
    console.log('Could not add marker to chart:', e.message);
  }
  
  console.log(`Chart marker added: ${tradeType} at ${price.toFixed(4)}`);
}

// Open a new position
function openPosition(type, price, settings, confidence, reasons) {
  const fee = settings.useOrderFee ? settings.orderFee : 0;
  const spread = settings.useSpread ? settings.spreadPips * AI_TRADING.contract.onePointMeans : 0;
  
  // Apply spread to entry
  const entryPrice = type === 'long' ? price + spread : price - spread;
  
  // Calculate position size (respect contract minimums)
  let size = Math.min(settings.positionSize, settings.maxPositionSize);
  size = Math.max(size, AI_TRADING.contract.minSize);
  
  AI_TRADING.state.position = {
    type,
    size,
    entryPrice,
    entryTime: new Date(),
    confidence,
    reasons
  };
  
  // Deduct fee
  AI_TRADING.state.capital -= fee;
  
  console.log(`Opened ${type} position at ${entryPrice}, size: ${size}, confidence: ${(confidence * 100).toFixed(1)}%`);
  
  // Record pattern for learning
  AI_TRADING.learning.recentPatterns.push({
    type,
    entryPrice,
    reasons: [...reasons],
    timestamp: Date.now()
  });
  
  updatePositionDisplay();
}

// Close position
async function closePosition(reason) {
  if (!AI_TRADING.state.position) return;
  
  const pos = AI_TRADING.state.position;
  const settings = getTradeSettings();
  
  // Get current price
  const tf1m = AI_TRADING.analysis.allTimeframes['1m'];
  const currentPrice = tf1m?.candles?.[tf1m.candles.length - 1]?.close || pos.entryPrice;
  
  const fee = settings.useOrderFee ? settings.orderFee : 0;
  const spread = settings.useSpread ? settings.spreadPips * AI_TRADING.contract.onePointMeans : 0;
  
  // Apply spread to exit
  const exitPrice = pos.type === 'long' ? currentPrice - spread : currentPrice + spread;
  
  // Calculate P&L
  const pointsGained = pos.type === 'long' 
    ? (exitPrice - pos.entryPrice) / AI_TRADING.contract.onePointMeans
    : (pos.entryPrice - exitPrice) / AI_TRADING.contract.onePointMeans;
  
  const pnl = pointsGained * AI_TRADING.contract.valuePerPoint * pos.size * AI_TRADING.contract.contractSizePerPoint - fee;
  
  // Update state
  AI_TRADING.state.capital += pnl;
  AI_TRADING.state.pnl += pnl;
  
  const isWin = pnl > 0;
  if (isWin) AI_TRADING.state.wins++;
  else AI_TRADING.state.losses++;
  
  // Record trade
  const trade = {
    type: pos.type,
    entryPrice: pos.entryPrice,
    exitPrice,
    size: pos.size,
    pnl,
    isWin,
    entryTime: pos.entryTime,
    exitTime: new Date(),
    reasons: pos.reasons,
    closeReason: reason
  };
  
  AI_TRADING.state.trades.unshift(trade);
  if (AI_TRADING.state.trades.length > 100) {
    AI_TRADING.state.trades = AI_TRADING.state.trades.slice(0, 100);
  }
  
  // Learning: adjust weights based on outcome
  adjustLearningWeights(trade);
  
  AI_TRADING.state.position = null;
  
  console.log(`Closed ${pos.type} at ${exitPrice}, P&L: $${pnl.toFixed(2)}, Reason: ${reason}`);
  
  saveAiTradingState();
  updateTradeList();
  updatePositionDisplay();
}

// Check stop loss and take profit
function checkStopLossTakeProfit(currentPrice, settings) {
  const pos = AI_TRADING.state.position;
  if (!pos) return;
  
  const pointsFromEntry = pos.type === 'long'
    ? (currentPrice - pos.entryPrice) / AI_TRADING.contract.onePointMeans
    : (pos.entryPrice - currentPrice) / AI_TRADING.contract.onePointMeans;
  
  // Check stop loss
  if (settings.stopLoss > 0 && pointsFromEntry < -settings.stopLoss) {
    closePosition('Stop loss hit');
    return;
  }
  
  // Check take profit
  if (settings.takeProfit > 0 && pointsFromEntry > settings.takeProfit) {
    closePosition('Take profit hit');
    return;
  }
}

// Adjust learning weights based on trade outcome
function adjustLearningWeights(trade) {
  const adjustAmount = 0.05;
  const weights = AI_TRADING.learning.weights;
  
  // Find which reasons contributed to this trade
  if (trade.reasons) {
    trade.reasons.forEach(reason => {
      const r = reason.toLowerCase();
      
      if (r.includes('trend') || r.includes('uptrend') || r.includes('downtrend')) {
        weights.trend = Math.max(0.5, Math.min(2, weights.trend + (trade.isWin ? adjustAmount : -adjustAmount)));
      }
      if (r.includes('rsi')) {
        weights.rsi = Math.max(0.5, Math.min(2, weights.rsi + (trade.isWin ? adjustAmount : -adjustAmount)));
      }
      if (r.includes('support') || r.includes('resistance')) {
        weights.wavePosition = Math.max(0.5, Math.min(2, weights.wavePosition + (trade.isWin ? adjustAmount : -adjustAmount)));
      }
      if (r.includes('news')) {
        weights.news = Math.max(0.5, Math.min(2, weights.news + (trade.isWin ? adjustAmount : -adjustAmount)));
      }
    });
  }
  
  // Update learning score
  AI_TRADING.learning.score = Math.max(0, AI_TRADING.learning.score + (trade.isWin ? 5 : -3));
  
  console.log('Learning weights updated:', weights);
}

// Update all UI elements
function updateAiTradingUI() {
  const state = AI_TRADING.state;
  
  // Capital
  document.getElementById('aiTradeCapital').textContent = `$${state.capital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  
  // P&L with color
  const pnlEl = document.getElementById('aiTradePnL');
  if (pnlEl) {
    const pnlStr = `${state.pnl >= 0 ? '+' : ''}$${state.pnl.toFixed(2)}`;
    pnlEl.textContent = pnlStr;
    pnlEl.className = `text-sm font-bold ${state.pnl > 0 ? 'text-green-600' : state.pnl < 0 ? 'text-red-600' : 'text-gray-600'}`;
  }
  
  // Win rate
  const totalTrades = state.wins + state.losses;
  const winRate = totalTrades > 0 ? (state.wins / totalTrades * 100).toFixed(1) : '--';
  document.getElementById('aiTradeWinRate').textContent = `${winRate}%`;
  
  // Trade count
  document.getElementById('aiTradeCount').textContent = totalTrades.toString();
  document.getElementById('aiTradeListCount').textContent = `${state.trades.length} trades`;
  
  // Learning score
  const scoreEl = document.getElementById('aiLearningScore');
  const barEl = document.getElementById('aiLearningBar');
  if (scoreEl) scoreEl.textContent = AI_TRADING.learning.score.toString();
  if (barEl) barEl.style.width = `${Math.min(100, AI_TRADING.learning.score)}%`;
  
  updatePositionDisplay();
}

// Update position display
function updatePositionDisplay() {
  const posEl = document.getElementById('aiTradePosition');
  if (!posEl) return;
  
  const pos = AI_TRADING.state.position;
  if (pos) {
    posEl.textContent = `${pos.type.toUpperCase()} ${pos.size}`;
    posEl.className = `text-sm font-bold ${pos.type === 'long' ? 'text-green-600' : 'text-red-600'}`;
  } else {
    posEl.textContent = 'None';
    posEl.className = 'text-sm font-bold text-gray-500';
  }
}

// Update trade list display
function updateTradeList() {
  const listEl = document.getElementById('aiTradeList');
  if (!listEl) return;
  
  const trades = AI_TRADING.state.trades.slice(0, 20); // Show last 20
  
  if (trades.length === 0) {
    listEl.innerHTML = '<div class="p-3 text-center text-gray-500 dark:text-gray-400 italic">No trades yet - click Start to begin AI trading</div>';
    return;
  }
  
  listEl.innerHTML = trades.map(t => {
    const pnlColor = t.isWin ? 'text-green-600' : 'text-red-600';
    const typeColor = t.type === 'long' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
    const time = new Date(t.exitTime).toLocaleTimeString();
    
    return `
      <div class="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700">
        <div class="flex items-center gap-2">
          <span class="px-1.5 py-0.5 rounded text-xs font-medium ${typeColor}">${t.type.toUpperCase()}</span>
          <span class="text-gray-600 dark:text-gray-400">${t.entryPrice.toFixed(4)} → ${t.exitPrice.toFixed(4)}</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="font-bold ${pnlColor}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</span>
          <span class="text-gray-400 text-xs">${time}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ==================== BACKTEST SIMULATION ====================

let BACKTEST_RUNNING = false;

// Initialize backtest event listener
function initBacktest() {
  const startBtn = document.getElementById('startBacktest');
  if (startBtn) {
    startBtn.addEventListener('click', runBacktestSimulation);
  }
  
  // Download JSON button
  const downloadBtn = document.getElementById('downloadBacktestJson');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadBacktestJson);
  }
  
  // Continuous backtest buttons
  const continuousBtn = document.getElementById('startContinuousBtn');
  if (continuousBtn) {
    continuousBtn.addEventListener('click', () => startContinuousBacktest('continuous'));
  }
  
  const untilProfitBtn = document.getElementById('runUntilProfitBtn');
  if (untilProfitBtn) {
    untilProfitBtn.addEventListener('click', () => startContinuousBacktest('until_profit'));
  }
  
  const stopContinuousBtn = document.getElementById('stopContinuousBtn');
  if (stopContinuousBtn) {
    stopContinuousBtn.addEventListener('click', stopContinuousBacktest);
  }
  
  // Auto-Optimize button
  const autoOptimizeBtn = document.getElementById('autoOptimizeBtn');
  if (autoOptimizeBtn) {
    autoOptimizeBtn.addEventListener('click', startAutoOptimize);
  }
  
  // AI Query input
  const aiQueryBtn = document.getElementById('aiQueryBtn');
  if (aiQueryBtn) {
    aiQueryBtn.addEventListener('click', submitAiQuery);
  }
  
  const aiQueryInput = document.getElementById('aiQueryInput');
  if (aiQueryInput) {
    aiQueryInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') submitAiQuery();
    });
  }
}

// Run backtest simulation on historical data
async function runBacktestSimulation() {
  if (BACKTEST_RUNNING) return;
  BACKTEST_RUNNING = true;
  
  const cycles = parseInt(document.getElementById('backtestCycles')?.value || '10');
  const timeframe = document.getElementById('backtestTimeframe')?.value || '1h';
  const exitStrategy = document.getElementById('backtestExitStrategy')?.value || 'dynamic';
  const tradeType = document.getElementById('backtestTradeType')?.value || 'both';
  const symbol = document.getElementById('aiSymbol')?.value || 'silver';
  
  // Get trading settings from backtest panel
  const settings = getBacktestSettings();
  
  // Get optimization parameters (random, learned, or default)
  const params = await getCurrentParams(symbol, settings);
  
  // Update UI
  const startBtn = document.getElementById('startBacktest');
  const progressContainer = document.getElementById('backtestProgressContainer');
  const resultsPanel = document.getElementById('backtestResults');
  const statusBadge = document.getElementById('backtestStatus');
  
  startBtn.disabled = true;
  startBtn.innerHTML = '<svg class="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="4" class="opacity-25"></circle><path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" class="opacity-75"></path></svg> Running...';
  progressContainer.classList.remove('hidden');
  resultsPanel.classList.add('hidden');
  statusBadge.textContent = 'Running';
  statusBadge.className = 'px-2 py-0.5 text-xs font-medium bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 rounded-full';
  
  // Fetch historical data
  const tfMap = {
    '10s': { api: '1m', interval: 10 },
    '1m': { api: '1m', interval: 60 },
    '5m': { api: '5m', interval: 300 },
    '15m': { api: '15m', interval: 900 },
    '1h': { api: '1h', interval: 3600 },
    '4h': { api: '1h', interval: 14400 },
    '1d': { api: '1d', interval: 86400 },
    '1w': { api: '1w', interval: 604800 },
    '1M': { api: '1M', interval: 2592000 }
  };
  const tfConfig = tfMap[timeframe] || { api: '1h', interval: 3600 };
  
  // Contract specs per asset (point value)
  const contractSpecs = {
    silver: 100, xagusd: 100,  // $100 per point
    gold: 100, xauusd: 100,
    oil: 10, wti: 10, brent: 10,
    sp500: 50, nasdaq: 20, dow: 10,
    eurusd: 100000, gbpusd: 100000, usdjpy: 1000,
    btcusd: 1, ethusd: 1
  };
  const pointValue = contractSpecs[symbol.toLowerCase()] || 100;
  
  let candles = [];
  try {
    const response = await fetch(`/api/market-data/${symbol}/${tfConfig.api}`);
    const data = await response.json();
    candles = data.candles || [];
  } catch (e) {
    console.error('Failed to fetch backtest data:', e);
    resetBacktestUI('Error');
    return;
  }
  
  if (candles.length < 100) {
    console.error('Not enough data for backtest');
    resetBacktestUI('No Data');
    return;
  }
  
  // Aggregate to 4h if needed
  if (timeframe === '4h') {
    candles = aggregateCandlesTo4H(candles);
  }
  
  // Run simulation cycles - cap cycles if not enough data
  const minCandlesPerCycle = 50;
  const maxCycles = Math.floor(candles.length / minCandlesPerCycle);
  const actualCycles = Math.min(cycles, maxCycles);
  
  if (actualCycles < 1) {
    console.error('Not enough data for requested cycles');
    resetBacktestUI('No Data');
    return;
  }
  
  const cycleResults = [];
  const candlesPerCycle = Math.floor(candles.length / actualCycles);
  let totalTrades = 0;
  let totalWins = 0;
  let totalPnL = 0;
  let allTrades = [];
  
  // Store candles for chart
  BACKTEST_DATA.candles = candles;
  
  for (let cycle = 0; cycle < actualCycles; cycle++) {
    // Update progress
    const pct = Math.round(((cycle + 1) / actualCycles) * 100);
    document.getElementById('backtestProgressLabel').textContent = `Cycle ${cycle + 1} / ${actualCycles}`;
    document.getElementById('backtestProgressPct').textContent = `${pct}%`;
    document.getElementById('backtestProgressBar').style.width = `${pct}%`;
    
    // Get candles for this cycle
    const startIdx = cycle * candlesPerCycle;
    const endIdx = Math.min(startIdx + candlesPerCycle, candles.length - 50); // Need room for max 50 candle hold
    const cycleCandles = candles.slice(startIdx, endIdx + 50);
    
    if (cycleCandles.length < 50) continue;
    
    // Run backtest on cycle data with dynamic exit strategy and optimizable params
    const cycleResult = await runCycleBacktest(cycleCandles, exitStrategy, settings, pointValue, params);
    cycleResults.push(cycleResult);
    
    // Collect all trades
    if (cycleResult.tradeList) {
      allTrades = allTrades.concat(cycleResult.tradeList);
    }
    
    totalTrades += cycleResult.trades;
    totalWins += cycleResult.wins;
    totalPnL += cycleResult.pnl;
    
    // Small delay to allow UI update
    await new Promise(r => setTimeout(r, 50));
  }
  
  // Calculate final results
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : 0;
  const avgTrade = totalTrades > 0 ? (totalPnL / totalTrades).toFixed(2) : 0;
  const bestCycle = cycleResults.length > 0 ? Math.max(...cycleResults.map(c => c.pnl)) : 0;
  
  // Store results for chart and download
  BACKTEST_DATA.trades = allTrades;
  BACKTEST_DATA.summary = {
    totalTrades,
    totalWins,
    winRate: parseFloat(winRate),
    totalPnL,
    avgTrade: parseFloat(avgTrade),
    bestCycle,
    cycles: actualCycles,
    exitStrategy: exitStrategy,
    params: ACTIVE_PARAMS
  };
  
  // Track best params found during optimization
  if (totalPnL > BEST_PARAMS_PNL && ACTIVE_PARAMS) {
    BEST_PARAMS_PNL = totalPnL;
    BEST_PARAMS = { ...ACTIVE_PARAMS };
  }
  
  console.log('Backtest complete:', {
    candles: BACKTEST_DATA.candles.length,
    trades: BACKTEST_DATA.trades.length,
    totalPnL,
    winRate
  });
  
  // Update results display
  document.getElementById('btTotalTrades').textContent = totalTrades;
  document.getElementById('btWinRate').textContent = `${winRate}%`;
  document.getElementById('btWinRate').className = `font-bold ${winRate >= 50 ? 'text-emerald-600' : 'text-red-600'}`;
  document.getElementById('btTotalPnL').textContent = `$${totalPnL.toFixed(2)}`;
  document.getElementById('btTotalPnL').className = `font-bold ${totalPnL >= 0 ? 'text-emerald-600' : 'text-red-600'}`;
  document.getElementById('btAvgTrade').textContent = `$${avgTrade}`;
  document.getElementById('btAvgTrade').className = `font-bold ${avgTrade >= 0 ? 'text-emerald-600' : 'text-red-600'}`;
  document.getElementById('btBestCycle').textContent = `$${bestCycle.toFixed(2)}`;
  
  // Show results
  resultsPanel.classList.remove('hidden');
  
  // Render chart and trade list (wait for DOM to update dimensions)
  setTimeout(() => {
    console.log('Rendering backtest chart and trade list...');
    renderBacktestSimChart();
    renderBacktestTradeList();
  }, 200);
  
  // Save results to AI brain for learning
  await saveBacktestToBrain(symbol, timeframe, allTrades, BACKTEST_DATA.summary);
  
  resetBacktestUI('Complete');
  
  // Check if continuous mode should continue
  if (CONTINUOUS_BACKTEST.running) {
    CONTINUOUS_BACKTEST.iterations++;
    CONTINUOUS_BACKTEST.bestPnL = Math.max(CONTINUOUS_BACKTEST.bestPnL, totalPnL);
    
    const continuousIterations = document.getElementById('continuousIterations');
    const continuousBestPnL = document.getElementById('continuousBestPnL');
    if (continuousIterations) continuousIterations.textContent = CONTINUOUS_BACKTEST.iterations;
    if (continuousBestPnL) continuousBestPnL.textContent = `$${CONTINUOUS_BACKTEST.bestPnL.toFixed(2)}`;
    
    // Check stop conditions
    const reachedMaxIterations = CONTINUOUS_BACKTEST.iterations >= CONTINUOUS_BACKTEST.maxIterations;
    const profitAchieved = CONTINUOUS_BACKTEST.mode === 'until_profit' && totalPnL > 0;
    
    if (reachedMaxIterations || profitAchieved) {
      stopContinuousBacktest();
      console.log(`Continuous backtest stopped - ${profitAchieved ? 'profit achieved!' : 'max iterations reached'}`);
    } else {
      // Continue after a short delay
      setTimeout(() => {
        if (CONTINUOUS_BACKTEST.running && !BACKTEST_RUNNING) {
          runBacktestSimulation();
        }
      }, 500);
    }
  }
}

// Save backtest results to AI brain
async function saveBacktestToBrain(asset, timeframe, trades, summary) {
  try {
    const response = await fetch('/api/ai-memory/brain/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset,
        timeframe,
        trades: trades.map(t => ({
          type: t.type,
          entryTime: t.entryTime,
          exitTime: t.exitTime,
          pnl: t.pnl,
          rsi: t.rsi,
          win: t.win,
          exitStrategy: t.exitStrategy,
          exitReason: t.exitReason,
          holdDuration: t.holdDuration,
          session: t.session,
          signalStrength: t.signalStrength
        })),
        summary
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('Backtest saved to brain:', result.patternsLearned, 'patterns learned');
    }
  } catch (e) {
    console.error('Failed to save backtest to brain:', e);
  }
}

// Continuous backtest state
let CONTINUOUS_BACKTEST = {
  running: false,
  mode: null,
  iterations: 0,
  bestPnL: -Infinity
};

function startContinuousBacktest(mode) {
  if (BACKTEST_RUNNING || CONTINUOUS_BACKTEST.running) {
    console.log('Backtest already running');
    return;
  }
  
  CONTINUOUS_BACKTEST = {
    running: true,
    mode: mode,
    iterations: 0,
    bestPnL: -Infinity,
    maxIterations: 100
  };
  
  const continuousControls = document.getElementById('continuousControls');
  const startContinuousBtn = document.getElementById('startContinuousBtn');
  const runUntilProfitBtn = document.getElementById('runUntilProfitBtn');
  const continuousIterations = document.getElementById('continuousIterations');
  const continuousBestPnL = document.getElementById('continuousBestPnL');
  
  if (continuousControls) continuousControls.classList.remove('hidden');
  if (startContinuousBtn) startContinuousBtn.classList.add('hidden');
  if (runUntilProfitBtn) runUntilProfitBtn.classList.add('hidden');
  if (continuousIterations) continuousIterations.textContent = '0';
  if (continuousBestPnL) continuousBestPnL.textContent = '$0.00';
  
  runBacktestSimulation();
}

function stopContinuousBacktest() {
  CONTINUOUS_BACKTEST.running = false;
  
  const continuousControls = document.getElementById('continuousControls');
  const startContinuousBtn = document.getElementById('startContinuousBtn');
  const runUntilProfitBtn = document.getElementById('runUntilProfitBtn');
  const autoOptimizeBtn = document.getElementById('autoOptimizeBtn');
  
  if (continuousControls) continuousControls.classList.add('hidden');
  if (startContinuousBtn) startContinuousBtn.classList.remove('hidden');
  if (runUntilProfitBtn) runUntilProfitBtn.classList.remove('hidden');
  if (autoOptimizeBtn) autoOptimizeBtn.classList.remove('hidden');
  
  // If we found better params during optimization, save them (even if negative, save the best found)
  if (BEST_PARAMS && CONTINUOUS_BACKTEST.mode === 'optimize') {
    saveBestParams();
  }
}

// Auto-optimize mode - runs many iterations with random params to find best combination
async function startAutoOptimize() {
  if (BACKTEST_RUNNING || CONTINUOUS_BACKTEST.running) {
    console.log('Backtest already running');
    return;
  }
  
  // Reset best params tracking
  BEST_PARAMS = null;
  BEST_PARAMS_PNL = -Infinity;
  
  // Force randomize mode for optimization
  const randomizeEl = document.getElementById('randomizeParams');
  const useLearnedEl = document.getElementById('useLearnedParams');
  if (randomizeEl) randomizeEl.checked = true;
  if (useLearnedEl) useLearnedEl.checked = false;
  
  // Start continuous mode with 50 iterations
  CONTINUOUS_BACKTEST = {
    running: true,
    mode: 'optimize',
    iterations: 0,
    bestPnL: -Infinity,
    maxIterations: 50
  };
  
  const continuousControls = document.getElementById('continuousControls');
  const startContinuousBtn = document.getElementById('startContinuousBtn');
  const runUntilProfitBtn = document.getElementById('runUntilProfitBtn');
  const autoOptimizeBtn = document.getElementById('autoOptimizeBtn');
  const continuousIterations = document.getElementById('continuousIterations');
  const continuousBestPnL = document.getElementById('continuousBestPnL');
  
  if (continuousControls) continuousControls.classList.remove('hidden');
  if (startContinuousBtn) startContinuousBtn.classList.add('hidden');
  if (runUntilProfitBtn) runUntilProfitBtn.classList.add('hidden');
  if (autoOptimizeBtn) autoOptimizeBtn.classList.add('hidden');
  if (continuousIterations) continuousIterations.textContent = '0';
  if (continuousBestPnL) continuousBestPnL.textContent = '$0.00';
  
  runBacktestSimulation();
}

// Save best parameters to brain
async function saveBestParams() {
  if (!BEST_PARAMS) return;
  
  const symbol = document.getElementById('aiSymbol')?.value || 'silver';
  const timeframe = document.getElementById('backtestTimeframe')?.value || '1h';
  
  try {
    const response = await fetch('/api/ai-memory/brain/params', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset: symbol,
        timeframe,
        params: BEST_PARAMS,
        pnl: BEST_PARAMS_PNL,
        timestamp: new Date().toISOString()
      })
    });
    
    if (response.ok) {
      console.log('Best params saved to brain:', BEST_PARAMS, 'P/L:', BEST_PARAMS_PNL);
      updateParamsDisplay(BEST_PARAMS, 'Best Found!');
    }
  } catch (e) {
    console.error('Failed to save best params:', e);
  }
}

// AI Query functionality
async function submitAiQuery() {
  const input = document.getElementById('aiQueryInput');
  const resultDiv = document.getElementById('aiQueryResult');
  const loadingDiv = document.getElementById('aiQueryLoading');
  
  if (!input || !input.value.trim()) return;
  
  const question = input.value.trim();
  const asset = document.getElementById('aiSymbol')?.value || 'silver';
  const timeframe = document.getElementById('aiTimeframe')?.value || '1h';
  
  // Show loading
  if (loadingDiv) loadingDiv.classList.remove('hidden');
  if (resultDiv) resultDiv.innerHTML = '';
  
  try {
    const response = await fetch('/api/ai/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, asset, timeframe })
    });
    
    if (response.ok) {
      const data = await response.json();
      if (resultDiv) {
        resultDiv.innerHTML = `
          <div class="text-sm text-gray-800 dark:text-gray-200">${data.answer}</div>
          <div class="text-xs text-gray-500 mt-2">
            Asset: ${data.context?.asset || asset} | 
            Current: $${data.context?.currentPrice?.toFixed(2) || 'N/A'} | 
            Brain Accuracy: ${data.context?.brainAccuracy || 0}%
          </div>
        `;
      }
    } else {
      if (resultDiv) resultDiv.innerHTML = '<div class="text-red-500 text-sm">Failed to get AI response</div>';
    }
  } catch (e) {
    console.error('AI Query error:', e);
    if (resultDiv) resultDiv.innerHTML = '<div class="text-red-500 text-sm">Error connecting to AI</div>';
  } finally {
    if (loadingDiv) loadingDiv.classList.add('hidden');
  }
}

// Parameter ranges for optimization
const PARAM_RANGES = {
  takeProfitPct: { min: 0.003, max: 0.05, default: 0.015 },    // 0.3% to 5%
  stopLossPct: { min: 0.003, max: 0.03, default: 0.01 },       // 0.3% to 3%
  trailingStopPct: { min: 0.003, max: 0.02, default: 0.008 },  // 0.3% to 2%
  atrMultiplier: { min: 0.5, max: 4.0, default: 2.0 },         // 0.5x to 4x ATR
  rsiOversold: { min: 20, max: 40, default: 30 },              // RSI oversold threshold
  rsiOverbought: { min: 60, max: 80, default: 70 },            // RSI overbought threshold
  positionSizePct: { min: 0.01, max: 0.2, default: 0.05 }      // 1% to 20% of capital
};

// Current active parameters (can be default, random, or learned)
let ACTIVE_PARAMS = null;
let BEST_PARAMS = null;
let BEST_PARAMS_PNL = -Infinity;

// Get default parameters
function getDefaultParams() {
  return {
    takeProfitPct: PARAM_RANGES.takeProfitPct.default,
    stopLossPct: PARAM_RANGES.stopLossPct.default,
    trailingStopPct: PARAM_RANGES.trailingStopPct.default,
    atrMultiplier: PARAM_RANGES.atrMultiplier.default,
    rsiOversold: PARAM_RANGES.rsiOversold.default,
    rsiOverbought: PARAM_RANGES.rsiOverbought.default,
    positionSizePct: PARAM_RANGES.positionSizePct.default
  };
}

// Generate random parameters within ranges with validation
function getRandomParams(capital) {
  const maxPositionPct = capital ? Math.min(PARAM_RANGES.positionSizePct.max, 1) : PARAM_RANGES.positionSizePct.max;
  
  // Generate take profit first, then ensure stop loss is smaller
  const takeProfitPct = PARAM_RANGES.takeProfitPct.min + Math.random() * (PARAM_RANGES.takeProfitPct.max - PARAM_RANGES.takeProfitPct.min);
  const maxStopLoss = Math.min(PARAM_RANGES.stopLossPct.max, takeProfitPct * 0.8); // SL must be < TP
  const stopLossPct = PARAM_RANGES.stopLossPct.min + Math.random() * (maxStopLoss - PARAM_RANGES.stopLossPct.min);
  
  // Trailing stop should be less than or equal to take profit
  const maxTrailing = Math.min(PARAM_RANGES.trailingStopPct.max, takeProfitPct);
  const trailingStopPct = PARAM_RANGES.trailingStopPct.min + Math.random() * (maxTrailing - PARAM_RANGES.trailingStopPct.min);
  
  return {
    takeProfitPct,
    stopLossPct,
    trailingStopPct,
    atrMultiplier: PARAM_RANGES.atrMultiplier.min + Math.random() * (PARAM_RANGES.atrMultiplier.max - PARAM_RANGES.atrMultiplier.min),
    rsiOversold: Math.floor(PARAM_RANGES.rsiOversold.min + Math.random() * (PARAM_RANGES.rsiOversold.max - PARAM_RANGES.rsiOversold.min)),
    rsiOverbought: Math.floor(PARAM_RANGES.rsiOverbought.min + Math.random() * (PARAM_RANGES.rsiOverbought.max - PARAM_RANGES.rsiOverbought.min)),
    positionSizePct: PARAM_RANGES.positionSizePct.min + Math.random() * (maxPositionPct - PARAM_RANGES.positionSizePct.min)
  };
}

// Fetch learned parameters from brain - sanitize to only include numeric params
async function getLearnedParams(asset) {
  try {
    const response = await fetch('/api/ai-memory/brain');
    if (!response.ok) return null;
    const brain = await response.json();
    const assetData = brain.assets?.[asset] || brain.assets?.[asset?.toLowerCase()];
    const stored = assetData?.bestParams;
    
    if (!stored) return null;
    
    // Extract only the numeric trading parameters, not metadata
    return {
      takeProfitPct: stored.takeProfitPct ?? PARAM_RANGES.takeProfitPct.default,
      stopLossPct: stored.stopLossPct ?? PARAM_RANGES.stopLossPct.default,
      trailingStopPct: stored.trailingStopPct ?? PARAM_RANGES.trailingStopPct.default,
      atrMultiplier: stored.atrMultiplier ?? PARAM_RANGES.atrMultiplier.default,
      rsiOversold: stored.rsiOversold ?? PARAM_RANGES.rsiOversold.default,
      rsiOverbought: stored.rsiOverbought ?? PARAM_RANGES.rsiOverbought.default,
      positionSizePct: stored.positionSizePct ?? PARAM_RANGES.positionSizePct.default
    };
  } catch (e) {
    console.error('Failed to fetch learned params:', e);
    return null;
  }
}

// Update parameters display in UI
function updateParamsDisplay(params, source) {
  const dispTP = document.getElementById('dispTP');
  const dispSL = document.getElementById('dispSL');
  const dispTrail = document.getElementById('dispTrail');
  const dispATR = document.getElementById('dispATR');
  const dispRSI = document.getElementById('dispRSI');
  const dispSize = document.getElementById('dispSize');
  const paramSource = document.getElementById('paramSource');
  
  if (dispTP) dispTP.textContent = (params.takeProfitPct * 100).toFixed(1) + '%';
  if (dispSL) dispSL.textContent = (params.stopLossPct * 100).toFixed(1) + '%';
  if (dispTrail) dispTrail.textContent = (params.trailingStopPct * 100).toFixed(1) + '%';
  if (dispATR) dispATR.textContent = params.atrMultiplier.toFixed(1);
  if (dispRSI) dispRSI.textContent = `${params.rsiOversold}/${params.rsiOverbought}`;
  if (dispSize) dispSize.textContent = (params.positionSizePct * 100).toFixed(0) + '%';
  if (paramSource) paramSource.textContent = source;
}

// Get current parameters based on settings
async function getCurrentParams(asset, settings) {
  const useLearnedEl = document.getElementById('useLearnedParams');
  const randomizeEl = document.getElementById('randomizeParams');
  const useLearned = useLearnedEl?.checked || false;
  const randomize = randomizeEl?.checked || false;
  
  let params;
  let source = 'Default';
  
  if (useLearned) {
    params = await getLearnedParams(asset);
    if (params) {
      source = 'Learned';
    } else {
      params = getDefaultParams();
      source = 'Default (no learned)';
    }
  } else if (randomize) {
    params = getRandomParams(settings.capital);
    source = 'Random';
  } else {
    params = getDefaultParams();
    source = 'Default';
  }
  
  // Enforce portfolio protection - position size cannot exceed capital limits
  // Max drawdown protection: never risk more than 2% of capital per trade
  const maxRiskPerTrade = 0.02; // 2% max risk per trade
  if (settings.capital && settings.capital > 0) {
    // Calculate max position based on capital allocation
    const maxPositionByCapital = settings.capital * params.positionSizePct;
    // Calculate max position based on risk: if SL triggers, max loss = 2% of capital
    const maxPositionByRisk = (settings.capital * maxRiskPerTrade) / params.stopLossPct;
    // Use the more conservative limit, but ensure we use at least minSize
    const capitalLimit = Math.min(maxPositionByCapital, maxPositionByRisk);
    // effectiveSize is capped by capital limits, using minSize as baseline
    params.effectiveSize = Math.min(capitalLimit / 100, settings.minSize * 10); // Cap at 10x minSize
    params.effectiveSize = Math.max(params.effectiveSize, settings.minSize); // But at least minSize
    params.maxDrawdownPct = maxRiskPerTrade;
  } else {
    params.effectiveSize = settings.minSize;
    params.maxDrawdownPct = maxRiskPerTrade;
  }
  
  updateParamsDisplay(params, source);
  ACTIVE_PARAMS = params;
  return params;
}

// Run a single backtest cycle on candle data - returns trade details with dynamic exits
async function runCycleBacktest(candles, exitStrategy, settings, pointValue, params) {
  let trades = 0;
  let wins = 0;
  let pnl = 0;
  const tradeList = [];
  
  // Lookback for indicator calculations
  const lookback = 14;
  const maxHoldCandles = 50; // Maximum hold period to prevent infinite holds
  
  // Cumulation tracking - increase position size after consecutive wins
  let consecutiveWins = 0;
  let currentPositionSize = settings.minSize || 1;
  const maxPositionSize = settings.maxSize || settings.maxPositionSize || 10;
  
  // Use provided params or defaults
  const exitParams = params || getDefaultParams();
  
  // Calculate ATR for volatility-based exits
  function calcATR(candleSlice) {
    if (candleSlice.length < 2) return 0;
    let trSum = 0;
    for (let j = 1; j < candleSlice.length; j++) {
      const high = candleSlice[j].high;
      const low = candleSlice[j].low;
      const prevClose = candleSlice[j-1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trSum += tr;
    }
    return trSum / (candleSlice.length - 1);
  }
  
  // Calculate RSI
  function calcRSI(candleSlice) {
    let gains = 0, losses = 0;
    for (let j = 1; j < candleSlice.length; j++) {
      const diff = candleSlice[j].close - candleSlice[j-1].close;
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const rs = losses > 0 ? gains / losses : 100;
    return 100 - (100 / (1 + rs));
  }
  
  // Find dynamic exit point based on strategy
  function findExitPoint(entryIdx, signal, entryPrice) {
    let exitIdx = entryIdx + 1;
    let exitReason = 'max_hold';
    let highestPrice = entryPrice;
    let lowestPrice = entryPrice;
    
    // Calculate ATR with minimum floor to prevent immediate exits
    let atr = calcATR(candles.slice(Math.max(0, entryIdx - lookback), entryIdx));
    const minATR = entryPrice * 0.002; // Minimum 0.2% of price as ATR floor
    if (atr < minATR) atr = minATR;
    
    // Ensure we don't go beyond candles array
    const maxExitIdx = Math.min(entryIdx + maxHoldCandles, candles.length - 1);
    
    for (let j = entryIdx + 1; j <= maxExitIdx; j++) {
      const candle = candles[j];
      const currentPrice = candle.close;
      
      // Update trailing high/low
      if (signal === 'long') {
        highestPrice = Math.max(highestPrice, candle.high);
      } else {
        lowestPrice = Math.min(lowestPrice, candle.low);
      }
      
      // Exit Strategy: AI Dynamic - uses multiple conditions
      if (exitStrategy === 'dynamic') {
        const priceMove = signal === 'long' 
          ? (currentPrice - entryPrice) / entryPrice
          : (entryPrice - currentPrice) / entryPrice;
        
        // ATR-based dynamic take profit
        const dynamicTP = (atr * exitParams.atrMultiplier) / entryPrice;
        if (priceMove >= dynamicTP) {
          exitIdx = j;
          exitReason = 'dynamic_tp';
          break;
        }
        
        // ATR-based dynamic stop loss
        const dynamicSL = (atr * 1.5) / entryPrice;
        if (priceMove <= -dynamicSL) {
          exitIdx = j;
          exitReason = 'dynamic_sl';
          break;
        }
        
        // RSI reversal exit
        const currentRSI = calcRSI(candles.slice(Math.max(0, j - lookback), j + 1));
        if (signal === 'long' && currentRSI > 70) {
          exitIdx = j;
          exitReason = 'rsi_overbought';
          break;
        }
        if (signal === 'short' && currentRSI < 30) {
          exitIdx = j;
          exitReason = 'rsi_oversold';
          break;
        }
      }
      
      // Exit Strategy: Trailing Stop
      else if (exitStrategy === 'trailing') {
        if (signal === 'long') {
          const trailStop = highestPrice * (1 - exitParams.trailingStopPct);
          if (candle.low <= trailStop) {
            exitIdx = j;
            exitReason = 'trailing_stop';
            break;
          }
        } else {
          const trailStop = lowestPrice * (1 + exitParams.trailingStopPct);
          if (candle.high >= trailStop) {
            exitIdx = j;
            exitReason = 'trailing_stop';
            break;
          }
        }
      }
      
      // Exit Strategy: Fixed TP/SL Target
      else if (exitStrategy === 'target') {
        const priceMove = signal === 'long' 
          ? (currentPrice - entryPrice) / entryPrice
          : (entryPrice - currentPrice) / entryPrice;
        
        if (priceMove >= exitParams.takeProfitPct) {
          exitIdx = j;
          exitReason = 'take_profit';
          break;
        }
        if (priceMove <= -exitParams.stopLossPct) {
          exitIdx = j;
          exitReason = 'stop_loss';
          break;
        }
      }
      
      // Exit Strategy: Signal Reversal - wait for opposite signal
      else if (exitStrategy === 'reversal') {
        const recentSlice = candles.slice(Math.max(0, j - lookback), j + 1);
        const currentRSI = calcRSI(recentSlice);
        const sma = recentSlice.reduce((sum, c) => sum + c.close, 0) / recentSlice.length;
        
        // Check for signal reversal
        if (signal === 'long' && (currentRSI > 70 || currentPrice < sma * 0.995)) {
          exitIdx = j;
          exitReason = 'signal_reversal';
          break;
        }
        if (signal === 'short' && (currentRSI < 30 || currentPrice > sma * 1.005)) {
          exitIdx = j;
          exitReason = 'signal_reversal';
          break;
        }
      }
    }
    
    // Ensure exitIdx is within bounds (fallback to last valid candle)
    if (exitIdx >= candles.length) {
      exitIdx = candles.length - 1;
      exitReason = 'max_hold';
    }
    
    return { exitIdx, exitReason };
  }
  
  // Main trading loop
  for (let i = lookback; i < candles.length - maxHoldCandles; i++) {
    // Calculate indicators
    const recentCandles = candles.slice(i - lookback, i);
    const sma = recentCandles.reduce((sum, c) => sum + c.close, 0) / lookback;
    const currentPrice = candles[i].close;
    const rsi = calcRSI(recentCandles);
    const atr = calcATR(recentCandles);
    
    // Calculate momentum
    const priceChange = (currentPrice - candles[i - lookback].close) / candles[i - lookback].close;
    
    // Determine entry signal with multiple confirmations
    let signal = null;
    let signalStrength = 0;
    
    // RSI signals - use dynamic thresholds from params
    if (rsi < exitParams.rsiOversold) {
      signalStrength += 2;
      signal = 'long';
    } else if (rsi > exitParams.rsiOverbought) {
      signalStrength += 2;
      signal = 'short';
    }
    
    // Trend signals
    if (currentPrice > sma * 1.002 && priceChange > 0.002) {
      signalStrength += (signal === 'long' || !signal) ? 1 : -1;
      signal = signal || 'long';
    } else if (currentPrice < sma * 0.998 && priceChange < -0.002) {
      signalStrength += (signal === 'short' || !signal) ? 1 : -1;
      signal = signal || 'short';
    }
    
    // Need minimum signal strength
    if (signalStrength < 1 || !signal) continue;
    
    // Skip if trade type doesn't match
    if (settings.tradeType === 'long' && signal === 'short') continue;
    if (settings.tradeType === 'short' && signal === 'long') continue;
    
    // Find dynamic exit point
    const entryCandle = candles[i];
    const entryPrice = entryCandle.close;
    const { exitIdx, exitReason } = findExitPoint(i, signal, entryPrice);
    
    // Bounds check - ensure exitIdx is valid
    if (exitIdx >= candles.length) {
      continue; // Skip this trade if no valid exit
    }
    
    const exitCandle = candles[exitIdx];
    if (!exitCandle) {
      continue; // Skip if exit candle doesn't exist
    }
    
    const exitPrice = exitCandle.close;
    const holdDuration = exitIdx - i;
    
    // Calculate P/L with spread using asset-specific point value
    // Spread is in price units, so multiply by pointValue and position size
    const spreadCost = settings.spread * pointValue * currentPositionSize;
    let tradePnL = 0;
    
    if (signal === 'long') {
      tradePnL = (exitPrice - entryPrice) * pointValue * currentPositionSize - spreadCost;
    } else {
      tradePnL = (entryPrice - exitPrice) * pointValue * currentPositionSize - spreadCost;
    }
    
    // Apply commission per trade (entry + exit) - flat fee per trade
    tradePnL -= settings.orderFee * 2;
    
    // Track win/loss for cumulation (applied to NEXT trade)
    const isWin = tradePnL > 0;
    
    // Update cumulation for next trade
    if (settings.cumulate) {
      if (isWin) {
        consecutiveWins++;
        // Increase position by 0.5 for every 2 consecutive wins, capped at max
        if (consecutiveWins % 2 === 0) {
          currentPositionSize = Math.min(currentPositionSize + 0.5, maxPositionSize);
        }
      } else {
        consecutiveWins = 0;
        currentPositionSize = settings.minSize || 1; // Reset to base on loss
      }
    }
    
    // Determine session based on entry time
    const entryHour = new Date(entryCandle.time * 1000).getUTCHours();
    let session = 'other';
    if (entryHour >= 0 && entryHour < 8) session = 'asian';
    else if (entryHour >= 8 && entryHour < 13) session = 'london';
    else if (entryHour >= 13 && entryHour < 21) session = 'ny';
    
    // Store trade details with exit strategy info
    tradeList.push({
      type: signal,
      entryTime: entryCandle.time,
      exitTime: exitCandle.time,
      entryPrice: entryPrice,
      exitPrice: exitPrice,
      pnl: tradePnL,
      rsi: rsi.toFixed(1),
      win: isWin,
      exitStrategy: exitStrategy,
      exitReason: exitReason,
      holdDuration: holdDuration,
      session: session,
      atr: atr.toFixed(4),
      signalStrength: signalStrength,
      positionSize: currentPositionSize
    });
    
    trades++;
    pnl += tradePnL;
    if (tradePnL > 0) wins++;
    
    // Skip ahead past the exit point
    i = exitIdx;
  }
  
  return { trades, wins, pnl, tradeList };
}

// Global storage for backtest results
let BACKTEST_DATA = {
  candles: [],
  trades: [],
  summary: {}
};
let backtestChart = null;

// Render backtest simulation chart with trade markers
function renderBacktestSimChart() {
  const container = document.getElementById('backtestChart');
  console.log('renderBacktestSimChart called', { 
    container: !!container, 
    candles: BACKTEST_DATA.candles?.length || 0,
    trades: BACKTEST_DATA.trades?.length || 0,
    firstTrade: BACKTEST_DATA.trades?.[0]
  });
  
  if (!container) {
    console.error('Backtest chart: container not found');
    return;
  }
  
  if (!BACKTEST_DATA.candles || BACKTEST_DATA.candles.length === 0) {
    console.error('Backtest chart: no candles data');
    return;
  }
  
  // Clear previous chart
  if (backtestChart) {
    try {
      backtestChart.remove();
    } catch (e) {
      console.warn('Error removing chart:', e);
    }
    backtestChart = null;
  }
  
  // Clear container
  container.innerHTML = '';
  
  const rect = container.getBoundingClientRect();
  console.log('Chart container rect:', rect.width, rect.height);
  
  if (rect.width === 0 || rect.height === 0) {
    console.error('Chart container has zero dimensions');
    container.innerHTML = '<div class="flex items-center justify-center h-full text-gray-400">Chart loading...</div>';
    return;
  }
  
  try {
  backtestChart = createChart(container, {
    width: rect.width || 400,
    height: rect.height || 192,
    layout: {
      background: { type: ColorType.Solid, color: '#0f172a' },
      textColor: '#94a3b8',
    },
    grid: {
      vertLines: { color: '#1e293b' },
      horzLines: { color: '#1e293b' },
    },
    timeScale: {
      borderColor: '#334155',
      timeVisible: true,
    },
    rightPriceScale: {
      borderColor: '#334155',
    },
  });
  
  // Add candlestick series for proper marker support
  const priceSeries = backtestChart.addSeries(CandlestickSeries, {
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderUpColor: '#22c55e',
    borderDownColor: '#ef4444',
    wickUpColor: '#22c55e',
    wickDownColor: '#ef4444',
    priceLineVisible: false,
  });
  priceSeries.setData(BACKTEST_DATA.candles.map(c => ({ 
    time: c.time, 
    open: c.open, 
    high: c.high, 
    low: c.low, 
    close: c.close 
  })));
  
  // Add trade markers
  const markers = [];
  BACKTEST_DATA.trades.forEach(trade => {
    // Entry marker
    markers.push({
      time: trade.entryTime,
      position: trade.type === 'long' ? 'belowBar' : 'aboveBar',
      color: trade.type === 'long' ? '#10b981' : '#ef4444',
      shape: trade.type === 'long' ? 'arrowUp' : 'arrowDown',
      text: trade.type === 'long' ? 'L' : 'S',
    });
    // Exit marker
    markers.push({
      time: trade.exitTime,
      position: 'inBar',
      color: trade.win ? '#10b981' : '#ef4444',
      shape: 'circle',
      text: trade.win ? '+' : '-',
    });
  });
  
  // Sort markers by time and add to chart
  markers.sort((a, b) => a.time - b.time);
  console.log('Setting chart markers:', markers.length, 'first:', markers[0]);
  createSeriesMarkers(priceSeries, markers);
  
  backtestChart.timeScale().fitContent();
  console.log('Chart rendered successfully');
  } catch (err) {
    console.error('Error rendering backtest chart:', err);
    container.innerHTML = `<div class="flex items-center justify-center h-full text-red-400">Chart error: ${err.message}</div>`;
  }
}

// Render trade list table
function renderBacktestTradeList() {
  const tbody = document.getElementById('backtestTradeListBody');
  console.log('renderBacktestTradeList called', { 
    tbody: !!tbody, 
    trades: BACKTEST_DATA.trades?.length || 0,
    firstTrade: BACKTEST_DATA.trades?.[0]
  });
  
  if (!tbody) {
    console.error('Trade list: tbody not found');
    return;
  }
  
  if (!BACKTEST_DATA.trades || BACKTEST_DATA.trades.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="px-2 py-4 text-center text-gray-500">No trades found</td></tr>';
    return;
  }
  
  tbody.innerHTML = '';
  
  BACKTEST_DATA.trades.forEach((trade, idx) => {
    const row = document.createElement('tr');
    row.className = `${trade.win ? 'bg-emerald-50/30 dark:bg-emerald-900/10' : 'bg-red-50/30 dark:bg-red-900/10'}`;
    
    const entryDate = new Date(trade.entryTime * 1000);
    const timeStr = entryDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    
    row.innerHTML = `
      <td class="px-2 py-1 text-gray-600 dark:text-gray-400">${idx + 1}</td>
      <td class="px-2 py-1 font-medium ${trade.type === 'long' ? 'text-emerald-600' : 'text-red-600'}">${trade.type.toUpperCase()}</td>
      <td class="px-2 py-1 text-right text-gray-700 dark:text-gray-300">${trade.entryPrice.toFixed(4)}</td>
      <td class="px-2 py-1 text-right text-gray-700 dark:text-gray-300">${trade.exitPrice.toFixed(4)}</td>
      <td class="px-2 py-1 text-right font-medium ${trade.pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}">$${trade.pnl.toFixed(2)}</td>
      <td class="px-2 py-1 text-gray-500 dark:text-gray-400">${timeStr}</td>
    `;
    tbody.appendChild(row);
  });
}

// Download backtest results as JSON
function downloadBacktestJson() {
  const data = {
    timestamp: new Date().toISOString(),
    symbol: document.getElementById('aiSymbol')?.value || 'unknown',
    timeframe: document.getElementById('backtestTimeframe')?.value || '1h',
    cycles: document.getElementById('backtestCycles')?.value || '10',
    exitStrategy: document.getElementById('backtestExitStrategy')?.value || 'dynamic',
    summary: BACKTEST_DATA.summary,
    trades: BACKTEST_DATA.trades.map(t => ({
      ...t,
      entryTimeISO: new Date(t.entryTime * 1000).toISOString(),
      exitTimeISO: new Date(t.exitTime * 1000).toISOString()
    }))
  };
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backtest_${data.symbol}_${data.timeframe}_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Aggregate 1h candles to 4h
function aggregateCandlesTo4H(candles) {
  const aggregated = [];
  for (let i = 0; i < candles.length; i += 4) {
    const chunk = candles.slice(i, i + 4);
    if (chunk.length < 4) break;
    aggregated.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((sum, c) => sum + (c.volume || 0), 0)
    });
  }
  return aggregated;
}

// Reset backtest UI
function resetBacktestUI(status) {
  BACKTEST_RUNNING = false;
  const startBtn = document.getElementById('startBacktest');
  startBtn.disabled = false;
  startBtn.innerHTML = '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> Run Backtest';
  
  // Hide progress bar unless showing results
  const progressContainer = document.getElementById('backtestProgressContainer');
  if (status !== 'Complete') {
    progressContainer?.classList.add('hidden');
  }
  
  const statusBadge = document.getElementById('backtestStatus');
  if (status === 'Complete') {
    statusBadge.textContent = 'Complete';
    statusBadge.className = 'px-2 py-0.5 text-xs font-medium bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 rounded-full';
  } else if (status === 'Error' || status === 'No Data') {
    statusBadge.textContent = status;
    statusBadge.className = 'px-2 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded-full';
  } else {
    statusBadge.textContent = 'Ready';
    statusBadge.className = 'px-2 py-0.5 text-xs font-medium bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-full';
  }
}

// Initialize backtest on load
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initBacktest, 600);
});

// Save trading state to localStorage
function saveAiTradingState() {
  localStorage.setItem('aiTradingState', JSON.stringify({
    state: AI_TRADING.state,
    learning: AI_TRADING.learning
  }));
}

// Load trading state from localStorage
function loadAiTradingState() {
  try {
    const saved = localStorage.getItem('aiTradingState');
    if (saved) {
      const data = JSON.parse(saved);
      if (data.state) AI_TRADING.state = data.state;
      if (data.learning) AI_TRADING.learning = data.learning;
      updateTradeList();
    }
  } catch (e) {
    console.error('Failed to load AI trading state:', e);
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initAiTrading, 500);
  setTimeout(loadLastSessionOnStartup, 800);
  setTimeout(initForecastOnStartup, 1000);
  setTimeout(() => {
    if (typeof loadMediaFiles === 'function') loadMediaFiles();
  }, 1200);
  setupBlankAppButton();
});

let forecastAutoRefreshInterval = null;

function initForecastOnStartup() {
  loadForecastFromStorage();
  loadForecastAccuracyFromBrain();
  startForecastAutoRefresh();
}

// Auto-refresh current day's actual candles every 60 seconds
function startForecastAutoRefresh() {
  if (forecastAutoRefreshInterval) {
    clearInterval(forecastAutoRefreshInterval);
  }
  
  forecastAutoRefreshInterval = setInterval(async () => {
    if (!forecastData.days || forecastData.days.length === 0) return;
    
    // Only update if we're on the forecast tab and viewing today
    const forecastTab = document.getElementById('forecastTab');
    if (!forecastTab || forecastTab.classList.contains('hidden')) return;
    
    try {
      await updateCurrentDayActualCandles();
    } catch (e) {
      console.warn('Forecast auto-refresh failed:', e);
    }
  }, 60000); // Every 60 seconds
}

// Fetch and update actual candles for the current day (day index 1 in 8-day forecast)
async function updateCurrentDayActualCandles() {
  // Find today's entry (has isToday flag)
  const todayIndex = forecastData.days.findIndex(d => d.isToday);
  if (todayIndex < 0) return;
  const today = forecastData.days[todayIndex];
  if (!today) return;
  
  const asset = forecastData.asset || 'silver';
  
  try {
    // Fetch latest price data
    const response = await fetch(`/api/market-data/${asset}/1h`);
    if (!response.ok) return;
    
    const data = await response.json();
    const allCandles = data.candles || [];
    
    if (allCandles.length === 0) return;
    
    // Filter to only today's candles (since midnight local time)
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const midnightTs = Math.floor(todayMidnight.getTime() / 1000);
    
    const todayCandles = allCandles.filter(c => c.time >= midnightTs);
    if (todayCandles.length === 0) return;
    
    // Update today's actual candles and prices
    today.actualPrices = todayCandles.map(p => p.close);
    today.actualCandles = todayCandles.map(p => ({
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
      time: p.time
    }));
    
    // Update current price
    const latestPrice = candles[candles.length - 1]?.close;
    if (latestPrice) {
      today.currentPrice = latestPrice;
      
      // Adjust intraday prediction based on actual movement
      if (today.actualCandles.length > 0) {
        const actualOpen = today.actualCandles[0].open;
        const actualCurrent = latestPrice;
        const actualChange = actualCurrent - actualOpen;
        const predictedChange = today.predictedClose - today.predictedOpen;
        
        // If actual movement differs significantly from predicted, adjust remaining prediction
        const adjustmentFactor = actualChange / (predictedChange || 0.01);
        if (Math.abs(adjustmentFactor - 1) > 0.3) {
          // Significant deviation - record for day-to-day learning
          console.log(`Forecast deviation detected: actual ${actualChange.toFixed(2)} vs predicted ${predictedChange.toFixed(2)}`);
        }
      }
    }
    
    saveForecastToStorage();
    
    // Re-render if viewing current day
    if (currentDetailDayIndex === 0) {
      showDayDetails(0);
    }
    renderMiniCharts();
    
    // Update current price display
    const priceValueEl = document.getElementById('forecastCurrentPriceValue');
    if (priceValueEl && latestPrice) {
      priceValueEl.textContent = `$${latestPrice.toFixed(2)}`;
    }
    
  } catch (e) {
    console.warn('Failed to update current day candles:', e);
  }
}

async function loadForecastAccuracyFromBrain() {
  try {
    const response = await fetch('/api/ai-memory/brain');
    const brain = await response.json();
    
    if (brain.forecastAccuracy !== undefined) {
      const accuracyScore = document.getElementById('forecastAccuracyScore');
      if (accuracyScore) {
        accuracyScore.textContent = `${brain.forecastAccuracy.toFixed(0)}%`;
        accuracyScore.className = `text-lg font-bold ${brain.forecastAccuracy >= 60 ? 'text-green-600' : brain.forecastAccuracy >= 40 ? 'text-yellow-600' : 'text-red-600'}`;
      }
    }
    
    if (brain.forecasts && brain.forecasts.length > 0) {
      forecastData.history = brain.forecasts.slice(-30);
      updateForecastHistory();
    }
  } catch (e) {
    console.warn('Failed to load forecast accuracy from brain:', e);
  }
}

// Load last Bot History session and AI Results on startup
async function loadLastSessionOnStartup() {
  try {
    const response = await fetch('/api/bot-history');
    const data = await response.json();
    if (data.entries && data.entries.length > 0) {
      const lastEntry = data.entries[0];
      if (lastEntry.id) {
        await loadBotEntry(lastEntry.id);
        console.log('Loaded last bot session:', lastEntry.id);
      }
    }
  } catch (e) {
    console.warn('Failed to load last session:', e);
  }
}

// Blank App button handler
function setupBlankAppButton() {
  const blankAppBtn = document.getElementById('blankAppBtn');
  if (blankAppBtn) {
    blankAppBtn.addEventListener('click', () => {
      if (!confirm('Reset app to blank state? This will clear all current settings.')) return;
      
      currentBotId = null;
      generatedBotCode = '';
      detectedVariables = [];
      
      const botCodeOutput = document.getElementById('botCodeOutput');
      const botOutputSection = document.getElementById('botOutputSection');
      const botNameInput = document.getElementById('botName');
      const strategyType = document.getElementById('strategyType');
      const assetSelect = document.getElementById('assetSelect');
      const timeframeSelect = document.getElementById('timeframeSelect');
      
      if (botCodeOutput) botCodeOutput.textContent = '';
      if (botOutputSection) botOutputSection.classList.add('hidden');
      if (botNameInput) botNameInput.value = '';
      if (strategyType) strategyType.value = 'trend-following';
      if (assetSelect) assetSelect.value = 'silver';
      if (timeframeSelect) timeframeSelect.value = '1m';
      
      const initialCapital = document.getElementById('initialCapital');
      const maxPositionSize = document.getElementById('maxPositionSize');
      const orderFee = document.getElementById('orderFee');
      const spread = document.getElementById('spread');
      const stopLossPercent = document.getElementById('stopLossPercent');
      const takeProfitPercent = document.getElementById('takeProfitPercent');
      
      if (initialCapital) initialCapital.value = '2000';
      if (maxPositionSize) maxPositionSize.value = '1';
      if (orderFee) orderFee.value = '7';
      if (spread) spread.value = '0.03';
      if (stopLossPercent) stopLossPercent.value = '2';
      if (takeProfitPercent) takeProfitPercent.value = '5';
      
      const sliderContainer = document.getElementById('codeVariableSliders');
      if (sliderContainer) sliderContainer.innerHTML = '';
      
      const aiResultsPanel = document.getElementById('aiResultsContent');
      if (aiResultsPanel) {
        const analysisEl = document.getElementById('aiTradingAnalysis');
        if (analysisEl) analysisEl.innerHTML = '<p class="text-sm text-gray-500 italic">No analysis yet</p>';
      }
      
      forecastData = { asset: 'silver', generatedAt: null, days: [], history: [] };
      localStorage.removeItem('forecastData');
      
      console.log('App reset to blank state');
    });
  }
}

// Forecast data storage
let forecastData = {
  asset: 'silver',
  generatedAt: null,
  days: [],
  history: []
};

let forecastDayChart = null;

function setupForecastHandlers() {
  const refreshBtn = document.getElementById('refreshForecastBtn');
  const assetSelect = document.getElementById('forecastAssetSelect');
  const closeDetailsBtn = document.getElementById('closeDayDetailsBtn');
  
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => generateForecast());
  }
  
  if (assetSelect) {
    assetSelect.addEventListener('change', () => {
      forecastData.asset = assetSelect.value;
      loadForecastFromStorage();
    });
  }
  
  if (closeDetailsBtn) {
    closeDetailsBtn.addEventListener('click', () => {
      document.getElementById('forecastDayDetails')?.classList.add('hidden');
    });
  }
  
  const updatePredictionBtn = document.getElementById('updateDayPredictionBtn');
  if (updatePredictionBtn) {
    updatePredictionBtn.addEventListener('click', () => updateCurrentDayPrediction());
  }
  
  setupNewscastHandlers();
  
  // Forecast day chart height slider
  const forecastHeightSlider = document.getElementById('forecastDayChartHeight');
  const forecastHeightLabel = document.getElementById('forecastDayChartHeightLabel');
  if (forecastHeightSlider) {
    forecastHeightSlider.addEventListener('input', () => {
      const height = forecastHeightSlider.value;
      if (forecastHeightLabel) forecastHeightLabel.textContent = height;
      // Redraw the chart with new height
      if (forecastData.days && forecastData.days.length > 0) {
        const selectedIdx = parseInt(document.querySelector('.forecast-day-btn.ring-2')?.dataset.day || '0');
        renderDayChart(forecastData.days[selectedIdx], selectedIdx);
      }
    });
  }
  
  // Forecast timeframe selector - only affects today's prediction
  const forecastTimeframeSelect = document.getElementById('forecastTimeframeSelect');
  if (forecastTimeframeSelect) {
    forecastTimeframeSelect.addEventListener('change', async () => {
      const selectedIdx = parseInt(document.querySelector('.forecast-day-btn.ring-2')?.dataset.day || '0');
      // Only regenerate prediction for today (day 0) - past days are historical
      if (selectedIdx === 0 && forecastData.days && forecastData.days[0]) {
        await updateCurrentDayPrediction();
      }
    });
  }
}

async function updateCurrentDayPrediction() {
  const btn = document.getElementById('updateDayPredictionBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Analyzing...';
  }
  
  try {
    const asset = forecastData.asset || 'silver';
    const timeframe = document.getElementById('forecastTimeframeSelect')?.value || '1h';
    
    // Map timeframe to API interval (1m, 5m, 15m provide higher granularity data for analysis)
    const tfToInterval = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h' };
    const apiInterval = tfToInterval[timeframe] || '1h';
    
    // Fetch historical data for volatility analysis (always fetch 1h for brain analysis)
    const [priceRes, brainRes, tfPriceRes] = await Promise.all([
      fetch(`/api/market-data/${asset}/1h`),
      fetch('/api/ai-memory/brain'),
      timeframe !== '1h' ? fetch(`/api/market-data/${asset}/${apiInterval}`) : Promise.resolve(null)
    ]);
    
    const priceResponse = await priceRes.json();
    const hourlyData = Array.isArray(priceResponse) ? priceResponse : (priceResponse.candles || priceResponse.data || []);
    const brainData = await brainRes.json().catch(() => ({}));
    
    // Parse timeframe-specific data if available
    let tfData = hourlyData;
    if (tfPriceRes && timeframe !== '1h') {
      try {
        const tfResponse = await tfPriceRes.json();
        tfData = Array.isArray(tfResponse) ? tfResponse : (tfResponse.candles || tfResponse.data || []);
      } catch (e) {
        console.warn('Failed to parse timeframe data, using 1h fallback:', e);
      }
    }
    
    // Use timeframe data for prediction, 1h data for volatility analysis
    const priceData = tfData.length > 0 ? tfData : hourlyData;
    
    if (priceData.length > 0 && forecastData.days && forecastData.days.length > 0) {
      const today = forecastData.days[0];
      const latestCandle = priceData[priceData.length - 1];
      const latestPrice = latestCandle?.close;
      
      // Filter today's candles from the timeframe data
      const todayMidnight = new Date();
      todayMidnight.setHours(0, 0, 0, 0);
      const midnightTs = Math.floor(todayMidnight.getTime() / 1000);
      const todayCandles = priceData.filter(c => c.time >= midnightTs);
      
      // Get past week from hourly data for volatility analysis (168 hours = 7 days)
      const pastWeekCandles = hourlyData.slice(-168);
      
      // Calculate historical volatility patterns
      const volatilityStats = analyzeHistoricalVolatility(pastWeekCandles);
      const hourlyPatterns = analyzeHourlyPatterns(pastWeekCandles);
      
      // Get current hour to project forward
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      
      // Generate realistic intraday prediction from current price to end of day
      const prediction = generateRealisticPrediction({
        currentPrice: latestPrice,
        currentHour,
        currentMinute,
        volatilityStats,
        hourlyPatterns,
        brainData,
        asset,
        timeframe,
        direction: today.direction,
        expectedMove: parseFloat(today.expectedMove) || 0
      });
      
      // Update today's data
      today.currentPrice = latestPrice;
      today.predictedPrices = prediction.prices;
      today.actualCandles = todayCandles.map(c => ({
        open: c.open, high: c.high, low: c.low, close: c.close, time: c.time
      }));
      today.actualPrices = todayCandles.map(c => c.close);
      
      // Generate suggested trades (only after current time)
      today.suggestedTrades = generateFutureTrades({
        prediction,
        currentHour,
        currentPrice: latestPrice,
        brainData,
        asset,
        volatilityStats
      });
      
      // Update entry/exit based on best future trade
      if (today.suggestedTrades && today.suggestedTrades.length > 0) {
        const bestTrade = today.suggestedTrades[0];
        today.entryPrice = bestTrade.entryPrice;
        today.entryTime = bestTrade.entryTime;
        today.exitPrice = bestTrade.exitPrice;
        today.exitTime = bestTrade.exitTime;
      }
      
      saveForecastToStorage();
      showDayDetails(0);
      renderMiniCharts();
      
      const priceValueEl = document.getElementById('forecastCurrentPriceValue');
      if (priceValueEl) {
        priceValueEl.textContent = `$${latestPrice.toFixed(2)}`;
      }
    }
  } catch (e) {
    console.error('Failed to update prediction:', e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Update Prediction';
    }
  }
}

// Analyze historical volatility from past week data
function analyzeHistoricalVolatility(candles) {
  if (!candles || candles.length < 10) {
    return { avgRange: 0.5, maxRange: 1.0, avgSwing: 0.3 };
  }
  
  const ranges = candles.map(c => ((c.high - c.low) / c.close) * 100);
  const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  const maxRange = Math.max(...ranges);
  
  // Calculate swing patterns (consecutive moves in same direction)
  let swings = [];
  let currentSwing = 0;
  for (let i = 1; i < candles.length; i++) {
    const move = candles[i].close - candles[i-1].close;
    if ((currentSwing >= 0 && move >= 0) || (currentSwing <= 0 && move <= 0)) {
      currentSwing += move;
    } else {
      if (currentSwing !== 0) swings.push(Math.abs(currentSwing));
      currentSwing = move;
    }
  }
  if (currentSwing !== 0) swings.push(Math.abs(currentSwing));
  
  const avgSwing = swings.length > 0 ? swings.reduce((a, b) => a + b, 0) / swings.length : 0.3;
  
  return { avgRange, maxRange, avgSwing };
}

// Analyze hourly patterns from historical data
function analyzeHourlyPatterns(candles) {
  const hourlyMoves = {};
  for (let h = 0; h < 24; h++) {
    hourlyMoves[h] = { moves: [], volatility: [] };
  }
  
  candles.forEach(c => {
    const hour = new Date(c.time * 1000).getHours();
    const move = ((c.close - c.open) / c.open) * 100;
    const vol = ((c.high - c.low) / c.open) * 100;
    hourlyMoves[hour].moves.push(move);
    hourlyMoves[hour].volatility.push(vol);
  });
  
  const patterns = {};
  for (let h = 0; h < 24; h++) {
    const moves = hourlyMoves[h].moves;
    const vols = hourlyMoves[h].volatility;
    patterns[h] = {
      avgMove: moves.length > 0 ? moves.reduce((a, b) => a + b, 0) / moves.length : 0,
      avgVolatility: vols.length > 0 ? vols.reduce((a, b) => a + b, 0) / vols.length : 0.2,
      bullishBias: moves.filter(m => m > 0).length / Math.max(moves.length, 1)
    };
  }
  
  return patterns;
}

// Generate realistic intraday prediction with proper swings
function generateRealisticPrediction({ currentPrice, currentHour, currentMinute, volatilityStats, hourlyPatterns, brainData, asset, timeframe, direction, expectedMove }) {
  const prices = [];
  const hoursRemaining = Math.max(1, 24 - currentHour);
  
  // Always generate exactly 24 prediction points to align with 24h chart display
  // Timeframe affects input data granularity for analysis, not output points
  const totalPoints = 24;
  
  // Get AI brain bias if available
  let brainBias = 0;
  if (brainData && brainData.assets && brainData.assets[asset]) {
    const assetBrain = brainData.assets[asset];
    if (assetBrain.patterns) {
      const bullishCount = Object.values(assetBrain.patterns).filter(p => p.direction === 'bullish').length;
      const totalPatterns = Object.keys(assetBrain.patterns).length;
      brainBias = totalPatterns > 0 ? (bullishCount / totalPatterns - 0.5) * 0.3 : 0;
    }
  }
  
  // Target end price based on direction and expected move
  const directionMultiplier = direction === 'bullish' ? 1 : -1;
  const targetEndPrice = currentPrice * (1 + (expectedMove / 100) * directionMultiplier);
  
  // Generate price path with realistic swings
  let price = currentPrice;
  const drift = (targetEndPrice - currentPrice) / totalPoints;
  const pointsPerHour = Math.max(1, totalPoints / hoursRemaining);
  
  for (let i = 0; i < totalPoints; i++) {
    const hourOfDay = Math.floor((currentHour + i / pointsPerHour) % 24);
    const hourPattern = hourlyPatterns[hourOfDay] || { avgVolatility: 0.2, bullishBias: 0.5 };
    
    // Base volatility scaled by historical patterns
    const baseVol = volatilityStats.avgRange * hourPattern.avgVolatility * 0.01;
    
    // Random walk with drift and mean reversion
    const randomComponent = (Math.random() - 0.5) * 2 * baseVol * currentPrice;
    const swingComponent = Math.sin(i * 0.5 + Math.random()) * volatilityStats.avgSwing * 0.3;
    const biasComponent = (hourPattern.bullishBias - 0.5 + brainBias) * baseVol * currentPrice * 0.5;
    
    // Apply movement
    price += drift + randomComponent + swingComponent + biasComponent;
    
    // Add some mean reversion towards target
    const deviation = price - (currentPrice + drift * i);
    price -= deviation * 0.1;
    
    prices.push(Math.max(price, currentPrice * 0.95));
  }
  
  // Ensure we end near target
  if (prices.length > 0) {
    const endAdjustment = (targetEndPrice - prices[prices.length - 1]) / (prices.length * 0.3);
    for (let i = Math.floor(prices.length * 0.7); i < prices.length; i++) {
      prices[i] += endAdjustment * (i - Math.floor(prices.length * 0.7));
    }
  }
  
  return { prices, targetEndPrice };
}

// Generate trade suggestions only after current time
function generateFutureTrades({ prediction, currentHour, currentPrice, brainData, asset, volatilityStats }) {
  const trades = [];
  const prices = prediction.prices;
  if (!prices || prices.length < 5) return trades;
  
  const hoursRemaining = Math.max(1, 24 - currentHour);
  const pointsPerHour = Math.max(1, prices.length / hoursRemaining);
  
  // Find swing points in the prediction
  const swingPoints = [];
  for (let i = 2; i < prices.length - 2; i++) {
    const prev2 = prices[i - 2];
    const prev1 = prices[i - 1];
    const curr = prices[i];
    const next1 = prices[i + 1];
    const next2 = prices[i + 2];
    
    // Local minimum (buy opportunity)
    if (curr < prev1 && curr < prev2 && curr < next1 && curr < next2) {
      swingPoints.push({ idx: i, type: 'low', price: curr });
    }
    // Local maximum (sell opportunity)
    if (curr > prev1 && curr > prev2 && curr > next1 && curr > next2) {
      swingPoints.push({ idx: i, type: 'high', price: curr });
    }
  }
  
  // Generate trades from swing points
  let lastTradeType = null;
  for (let i = 0; i < swingPoints.length; i++) {
    const point = swingPoints[i];
    // Calculate hour for this point (safely handle division)
    const pointHour = Math.min(23, currentHour + Math.floor(point.idx / pointsPerHour));
    
    // Only suggest future trades (after current time)
    if (pointHour <= currentHour) continue;
    
    // Alternate between entries and exits
    if (point.type === 'low' && lastTradeType !== 'entry') {
      // Find next high for exit
      const nextHigh = swingPoints.find((p, j) => j > i && p.type === 'high');
      if (nextHigh) {
        const exitHour = Math.min(23, currentHour + Math.floor(nextHigh.idx / pointsPerHour));
        const pnlPercent = ((nextHigh.price - point.price) / point.price) * 100;
        
        if (pnlPercent > 0.1) { // Only if profitable
          trades.push({
            direction: 'LONG',
            entryPrice: point.price,
            entryTime: `${String(Math.floor(pointHour)).padStart(2, '0')}:00`,
            entryHour: pointHour,
            entryIdx: point.idx,
            exitPrice: nextHigh.price,
            exitTime: `${String(Math.min(23, Math.floor(exitHour))).padStart(2, '0')}:00`,
            exitHour: exitHour,
            exitIdx: nextHigh.idx,
            expectedPnL: pnlPercent.toFixed(2) + '%',
            confidence: Math.min(90, 60 + volatilityStats.avgRange * 10)
          });
          lastTradeType = 'entry';
          i = swingPoints.indexOf(nextHigh); // Skip to after this trade
        }
      }
    } else if (point.type === 'high' && lastTradeType !== 'entry') {
      // Find next low for exit (short trade)
      const nextLow = swingPoints.find((p, j) => j > i && p.type === 'low');
      if (nextLow) {
        const exitHour = Math.min(23, currentHour + Math.floor(nextLow.idx / pointsPerHour));
        const pnlPercent = ((point.price - nextLow.price) / point.price) * 100;
        
        if (pnlPercent > 0.1) { // Only if profitable
          trades.push({
            direction: 'SHORT',
            entryPrice: point.price,
            entryTime: `${String(Math.floor(pointHour)).padStart(2, '0')}:00`,
            entryHour: pointHour,
            entryIdx: point.idx,
            exitPrice: nextLow.price,
            exitTime: `${String(Math.min(23, Math.floor(exitHour))).padStart(2, '0')}:00`,
            exitHour: exitHour,
            exitIdx: nextLow.idx,
            expectedPnL: pnlPercent.toFixed(2) + '%',
            confidence: Math.min(90, 60 + volatilityStats.avgRange * 10)
          });
          lastTradeType = 'entry';
          i = swingPoints.indexOf(nextLow); // Skip to after this trade
        }
      }
    }
  }
  
  // Sort by confidence and expected P/L
  trades.sort((a, b) => {
    const aPnL = parseFloat(a.expectedPnL);
    const bPnL = parseFloat(b.expectedPnL);
    return (b.confidence + bPnL * 10) - (a.confidence + aPnL * 10);
  });
  
  return trades;
}

function loadForecastFromStorage() {
  try {
    const saved = localStorage.getItem('forecastData');
    if (saved) {
      forecastData = JSON.parse(saved);
      updateForecastUI();
      updateForecastHistory();
      checkAndRotateForecast();
    }
  } catch (e) {
    console.warn('Failed to load forecast:', e);
  }
}

function saveForecastToStorage() {
  try {
    localStorage.setItem('forecastData', JSON.stringify(forecastData));
  } catch (e) {
    console.warn('Failed to save forecast:', e);
  }
}

async function generateForecast() {
  const refreshBtn = document.getElementById('refreshForecastBtn');
  const cardsContainer = document.getElementById('forecastCardsContainer');
  const outlookText = document.getElementById('forecastOutlookText');
  
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Generating...';
  }
  
  if (outlookText) outlookText.textContent = 'Analyzing market data...';
  
  try {
    const asset = document.getElementById('forecastAssetSelect')?.value || 'silver';
    
    const [brainRes, priceRes] = await Promise.all([
      fetch('/api/ai-memory/brain'),
      fetch(`/api/market-data/${asset}/1h`)
    ]);
    
    const brainData = await brainRes.json();
    const priceResponse = await priceRes.json();
    const priceData = Array.isArray(priceResponse) ? priceResponse : (priceResponse.candles || priceResponse.data || []);
    
    const response = await fetch('/api/ai/forecast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset,
        brain: brainData,
        recentPrices: priceData.slice(-168),
        settings: {
          initialCapital: parseFloat(document.getElementById('initialCapital')?.value) || 2000,
          stopLoss: parseFloat(document.getElementById('stopLossPercent')?.value) || 2,
          takeProfit: parseFloat(document.getElementById('takeProfitPercent')?.value) || 5
        }
      })
    });
    
    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error);
    }
    
    forecastData = {
      asset,
      generatedAt: new Date().toISOString(),
      days: result.days || generateMockForecast(asset, priceData, brainData),
      history: forecastData.history || []
    };
    
    saveForecastToStorage();
    updateForecastUI();
    
  } catch (e) {
    console.error('Forecast generation failed:', e);
    const asset = document.getElementById('forecastAssetSelect')?.value || 'silver';
    try {
      const priceRes = await fetch(`/api/market-data/${asset}/1h`);
      const priceResponse = await priceRes.json();
      const priceData = Array.isArray(priceResponse) ? priceResponse : (priceResponse.candles || priceResponse.data || []);
      const brainRes = await fetch('/api/ai-memory/brain');
      const brainData = await brainRes.json();
      
      forecastData = {
        asset,
        generatedAt: new Date().toISOString(),
        days: generateMockForecast(asset, priceData, brainData),
        history: forecastData.history || []
      };
      saveForecastToStorage();
      updateForecastUI();
    } catch (e2) {
      if (outlookText) outlookText.textContent = 'Failed to generate forecast';
    }
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh';
    }
  }
}

// Sydney timezone utilities
const SYDNEY_OFFSET_HOURS = 11; // AEDT (daylight saving)

function toSydneyTime(date) {
  const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
  return new Date(utc + (SYDNEY_OFFSET_HOURS * 3600000));
}

function fromSydneyTime(sydneyDate) {
  const utc = sydneyDate.getTime() - (SYDNEY_OFFSET_HOURS * 3600000);
  return new Date(utc);
}

function formatSydneyTime(date, format = 'time') {
  const sydney = toSydneyTime(date);
  if (format === 'time') {
    return sydney.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true });
  } else if (format === 'date') {
    return sydney.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  return sydney.toLocaleString('en-AU');
}

function isTradingHours(date) {
  const sydney = toSydneyTime(date);
  const day = sydney.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const hour = sydney.getHours();
  
  // Trading: Mon 10am - Sat 9am Sydney
  // Closed: Sat 9am - Mon 10am
  if (day === 0) return false; // Sunday - closed
  if (day === 6 && hour >= 9) return false; // Saturday after 9am - closed
  if (day === 1 && hour < 10) return false; // Monday before 10am - closed
  return true;
}

function getNextTradingSession(date) {
  const sydney = toSydneyTime(date);
  const day = sydney.getDay();
  const hour = sydney.getHours();
  
  if (day === 0 || (day === 6 && hour >= 9)) {
    // Weekend - next session is Monday 10am
    const daysUntilMonday = day === 0 ? 1 : 2;
    const nextMonday = new Date(sydney);
    nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
    nextMonday.setHours(10, 0, 0, 0);
    return fromSydneyTime(nextMonday);
  }
  if (day === 1 && hour < 10) {
    const monday10am = new Date(sydney);
    monday10am.setHours(10, 0, 0, 0);
    return fromSydneyTime(monday10am);
  }
  return date; // Already in trading hours
}

function generateMockForecast(asset, priceData, brainData) {
  const prices = Array.isArray(priceData) ? priceData : (priceData?.candles || priceData?.data || []);
  if (prices.length === 0) return [];
  
  // Get trading day settings from TIME & SESSION FILTERS
  const tradingDays = {
    0: document.getElementById('tradeSun')?.checked || false,  // Sunday
    1: document.getElementById('tradeMon')?.checked ?? true,   // Monday
    2: document.getElementById('tradeTue')?.checked ?? true,   // Tuesday
    3: document.getElementById('tradeWed')?.checked ?? true,   // Wednesday
    4: document.getElementById('tradeThu')?.checked ?? true,   // Thursday
    5: document.getElementById('tradeFri')?.checked ?? true,   // Friday
    6: document.getElementById('tradeSat')?.checked || false   // Saturday
  };
  
  // Get trading hours from settings
  const tradingStartTime = document.getElementById('tradingStartTime')?.value || '00:00';
  const tradingEndTime = document.getElementById('tradingEndTime')?.value || '23:59';
  const [startHour, startMin] = tradingStartTime.split(':').map(Number);
  const [endHour, endMin] = tradingEndTime.split(':').map(Number);
  
  // Get Backtest Simulation settings for trades
  const backtestSettings = {
    capital: parseFloat(document.getElementById('backtestCapital')?.value) || 10000,
    positionSize: parseFloat(document.getElementById('backtestPositionSize')?.value) || 1,
    orderFee: parseFloat(document.getElementById('orderFee')?.value) || 7,
    spreadCost: parseFloat(document.getElementById('spreadCost')?.value) || 0.02
  };
  
  // Get real current price and recent data
  const recentPrices = prices.slice(-168); // Last 7 days of hourly data
  const currentPrice = recentPrices[recentPrices.length - 1]?.close || 30;
  
  // Calculate trend and volatility from actual data
  const priceChanges = [];
  for (let i = 1; i < recentPrices.length; i++) {
    priceChanges.push(recentPrices[i].close - recentPrices[i-1].close);
  }
  const avgChange = priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length;
  const volatility = Math.sqrt(priceChanges.reduce((sum, c) => sum + c * c, 0) / priceChanges.length);
  
  // === ENHANCED AI MEMORY INTEGRATION ===
  // Get asset-specific brain data (all data scoped to asset)
  const assetBrain = brainData?.assets?.[asset] || brainData?.assets?.[asset?.toLowerCase()] || {};
  const learnedPatterns = assetBrain.learnedPatterns || [];
  // Session memory from asset level (recent prediction outcomes)
  const sessionMemory = assetBrain.sessionMemory || brainData?.sessionMemory || [];
  // Confidence level from asset accuracy or global
  const assetAccuracy = parseFloat(assetBrain.accuracy) || 50;
  const confidenceLevel = assetAccuracy; // Use asset-specific accuracy as confidence
  const correlations = brainData?.correlations || {};
  
  // Analyze learned patterns to determine direction bias
  let longPnL = 0, shortPnL = 0, longWins = 0, shortWins = 0, totalPatterns = 0;
  let sessionBias = { asian: 0, london: 0, ny: 0 };
  
  learnedPatterns.forEach(p => {
    const pnl = p.totalPnL || 0;
    const success = p.successRate || 50;
    const occurrences = p.occurrences || 1;
    
    if (p.name.includes('_long_')) {
      longPnL += pnl;
      if (success > 60) longWins += occurrences;
    } else if (p.name.includes('_short_')) {
      shortPnL += pnl;
      if (success > 60) shortWins += occurrences;
    }
    
    // Track session performance
    if (p.name.includes('asian_')) sessionBias.asian += pnl;
    else if (p.name.includes('london_')) sessionBias.london += pnl;
    else if (p.name.includes('ny_')) sessionBias.ny += pnl;
    
    totalPatterns += occurrences;
  });
  
  // Analyze session memory for recent prediction accuracy
  let recentCorrectPredictions = 0;
  let recentTotalPredictions = 0;
  sessionMemory.slice(-10).forEach(mem => {
    recentTotalPredictions++;
    if (mem.correct || mem.directionCorrect) recentCorrectPredictions++;
  });
  const recentAccuracyBias = recentTotalPredictions > 0 ? 
    (recentCorrectPredictions / recentTotalPredictions - 0.5) * 0.3 : 0; // -0.15 to +0.15 adjustment
  
  // Calculate AI-driven direction bias (weighted by learned patterns + session memory)
  const patternBias = totalPatterns > 0 ? (longPnL - shortPnL) / (Math.abs(longPnL) + Math.abs(shortPnL) + 1) : 0;
  const marketTrend = avgChange > 0 ? 0.2 : avgChange < 0 ? -0.2 : 0;
  // Combine: 50% patterns, 30% market trend, 20% recent session accuracy
  const combinedBias = (patternBias * 0.5) + (marketTrend * 0.3) + (recentAccuracyBias * 0.2);
  
  // Get previous day corrections from storage (day-to-day learning)
  const storedForecast = localStorage.getItem('forecastData');
  let previousCorrection = 0;
  if (storedForecast) {
    try {
      const prevData = JSON.parse(storedForecast);
      if (prevData.history && prevData.history.length > 0) {
        const lastPrediction = prevData.history[prevData.history.length - 1];
        if (lastPrediction.actualClose && lastPrediction.predictedClose) {
          // Learn from previous day's error
          previousCorrection = (lastPrediction.actualClose - lastPrediction.predictedClose) / lastPrediction.predictedClose;
        }
      }
    } catch (e) {}
  }
  
  // Determine best trading session based on brain memory
  const bestSession = Object.entries(sessionBias).sort((a, b) => b[1] - a[1])[0]?.[0] || 'london';
  
  // Calculate overall brain confidence adjustment
  const brainConfidenceMultiplier = 0.5 + (confidenceLevel / 100) * 0.5; // 0.5 to 1.0
  
  const days = [];
  const now = new Date();
  const sydneyNow = toSydneyTime(now);
  let lastClose = currentPrice;
  let calendarOffset = 0;
  
  // Keep adding days until we have 7 trading days
  while (days.length < 7 && calendarOffset < 14) {
    const dayDate = new Date(now);
    dayDate.setDate(dayDate.getDate() + calendarOffset);
    const sydneyDate = toSydneyTime(dayDate);
    const dayOfWeek = sydneyDate.getDay();
    
    calendarOffset++;
    
    // Skip days not enabled in TIME & SESSION FILTERS settings
    if (!tradingDays[dayOfWeek]) continue;
    
    // Calculate trading hours for this day using settings
    let tradingStart = new Date(sydneyDate);
    let tradingEnd = new Date(sydneyDate);
    tradingStart.setHours(startHour, startMin, 0, 0);
    tradingEnd.setHours(endHour, endMin, 59, 999);
    
    // For today, check if trading has already ended
    const isToday = sydneyDate.toDateString() === sydneyNow.toDateString();
    if (isToday) {
      const currentHour = sydneyNow.getHours();
      const currentMin = sydneyNow.getMinutes();
      // Skip if current time is past trading end time
      if (currentHour > endHour || (currentHour === endHour && currentMin >= endMin)) continue;
    }
    
    // === AI-ENHANCED PREDICTION MODEL ===
    // Use brain memory, learned patterns, and day-to-day corrections
    const dayVolatility = volatility * (1 + (Math.random() - 0.5) * 0.5);
    
    // Direction is weighted by: brain patterns (60%), market trend (30%), previous correction (10%)
    const aiDirection = combinedBias + (previousCorrection * 0.3) + (Math.random() - 0.5) * 0.2;
    const directionMultiplier = aiDirection > 0 ? 1 : -1;
    const biasStrength = Math.abs(aiDirection) * brainConfidenceMultiplier;
    
    // Expected change incorporates brain-learned patterns
    const baseChange = avgChange * 24 * directionMultiplier;
    const brainAdjustment = dayVolatility * biasStrength * directionMultiplier;
    const expectedChange = baseChange + brainAdjustment + (Math.random() - 0.5) * dayVolatility;
    
    const openPrice = lastClose; // Continuity: open = previous close
    const predictedClose = openPrice + expectedChange;
    const predictedHigh = Math.max(openPrice, predictedClose) + dayVolatility * (1 + Math.random());
    const predictedLow = Math.min(openPrice, predictedClose) - dayVolatility * (1 + Math.random());
    
    const direction = predictedClose > openPrice ? 'bullish' : 'bearish';
    
    // Confidence is based on brain data quality
    const patternStrength = Math.min(100, totalPatterns / 10); // More patterns = more confidence
    const baseConfidence = 50 + (patternStrength * 0.3) + (Math.abs(expectedChange / openPrice) * 300);
    const confidence = Math.min(90, Math.max(30, baseConfidence * brainConfidenceMultiplier));
    
    // Calculate entry/exit based on backtest-style logic
    const entryOffset = direction === 'bullish' ? 0.3 : 0.7;
    const exitOffset = direction === 'bullish' ? 0.8 : 0.2;
    const entryPrice = predictedLow + (predictedHigh - predictedLow) * entryOffset;
    const exitPrice = predictedLow + (predictedHigh - predictedLow) * exitOffset;
    
    // === DETAILED TRADE INFORMATION (using Backtest Simulation settings) ===
    const tradeDirection = direction === 'bullish' ? 'LONG' : 'SHORT';
    const positionSize = backtestSettings.positionSize; // $/point (e.g., $1/point)
    const fees = backtestSettings.orderFee * 2; // Entry + exit fees
    const priceDiff = direction === 'bullish' ? exitPrice - entryPrice : entryPrice - exitPrice;
    // Convert price difference to points (1 point = $0.01 for commodities like silver/gold)
    const pointValue = 0.01; // Standard: 1 cent = 1 point
    const priceDiffInPoints = priceDiff / pointValue; // e.g., $2.99 / 0.01 = 299 points
    const grossPnL = priceDiffInPoints * positionSize; // 299 points * $1/point = $299
    const spreadCostPoints = backtestSettings.spreadCost / pointValue; // Convert spread to points
    const spreadCost = spreadCostPoints * positionSize;
    const netPnL = grossPnL - spreadCost - fees;
    const capitalUsed = backtestSettings.capital; // Use capital from settings, not entry * position
    const returnPct = (netPnL / capitalUsed) * 100;
    
    // Trading hours for entry/exit using settings (Sydney time)
    const sessionDuration = endHour - startHour;
    const entryHour = startHour + Math.floor(Math.random() * Math.max(1, sessionDuration / 3));
    const exitHour = Math.min(endHour - 1, startHour + Math.floor(sessionDuration * 0.6) + Math.floor(Math.random() * (sessionDuration / 3)));
    
    // Generate hourly predictions with smooth continuity
    const tradingHoursCount = Math.max(1, sessionDuration);
    const hourlyPrices = generateSmoothedHourlyPrices(openPrice, predictedClose, predictedHigh, predictedLow, tradingHoursCount, dayVolatility);
    
    // Get actual candles for today (first trading day) - full OHLC data for candlestick chart
    let actualPrices = [];
    let actualCandles = [];
    if (isToday && recentPrices.length > 0) {
      // Get hourly candles for today - use whatever data we have
      const todayCandles = recentPrices.slice(-Math.min(24, recentPrices.length));
      actualPrices = todayCandles.map(p => p.close);
      actualCandles = todayCandles.map(p => ({
        open: p.open,
        high: p.high,
        low: p.low,
        close: p.close,
        time: p.time
      }));
    }
    
    days.push({
      date: fromSydneyTime(sydneyDate).toISOString(),
      dayName: sydneyDate.toLocaleDateString('en-AU', { weekday: 'short' }),
      dayOfWeek,
      direction,
      confidence,
      predictedOpen: openPrice,
      predictedHigh,
      predictedLow,
      predictedClose,
      expectedMove: ((predictedClose - openPrice) / openPrice * 100).toFixed(2),
      entryPrice,
      exitPrice,
      entryTime: `${entryHour}:00 AEDT`,
      exitTime: `${exitHour}:00 AEDT`,
      tradingStart: formatSydneyTime(fromSydneyTime(tradingStart)),
      tradingEnd: formatSydneyTime(fromSydneyTime(tradingEnd)),
      summary: generateDaySummary(direction === 'bullish' ? 1 : -1, confidence, asset, expectedChange, openPrice),
      predictedPrices: hourlyPrices,
      actualPrices,
      actualCandles, // Full OHLC data for candlestick rendering
      currentPrice: days.length === 0 ? currentPrice : null,
      // Detailed trade information using Backtest Simulation settings
      trade: {
        direction: tradeDirection,
        positionSize,
        entryPrice,
        exitPrice,
        priceDiff, // Actual price difference in $
        points: priceDiffInPoints, // Points (1 point = $0.01)
        grossPnL,
        netPnL,
        fees,
        spreadCost,
        capitalUsed,
        returnPct,
        capital: backtestSettings.capital
      },
      // AI Brain metadata
      brainMetadata: {
        patternBias: patternBias.toFixed(3),
        previousCorrection: previousCorrection.toFixed(4),
        confidenceMultiplier: brainConfidenceMultiplier.toFixed(2),
        bestSession,
        totalPatternsUsed: totalPatterns,
        recentAccuracy: recentTotalPredictions > 0 ? 
          `${recentCorrectPredictions}/${recentTotalPredictions}` : 'N/A',
        assetAccuracy: `${assetAccuracy.toFixed(0)}%`
      },
      backtestResult: null // Will be populated by runForecastBacktest
    });
    
    lastClose = predictedClose; // Continuity for next day
  }
  
  return days;
}

function generateSmoothedHourlyPrices(open, close, high, low, hours, volatility) {
  const prices = [];
  const range = high - low;
  const trend = close - open;
  
  // Create smooth path from open to close with realistic volatility
  for (let h = 0; h < hours; h++) {
    const progress = h / (hours - 1);
    // Use sine wave for natural price movement
    const basePrice = open + trend * progress;
    const oscillation = Math.sin(progress * Math.PI * 2) * range * 0.2;
    const noise = (Math.random() - 0.5) * volatility * 0.5;
    
    let price = basePrice + oscillation + noise;
    // Keep within high/low bounds
    price = Math.max(low, Math.min(high, price));
    prices.push(price);
  }
  
  // Ensure first and last match open/close
  prices[0] = open;
  prices[prices.length - 1] = close;
  
  return prices;
}

function generateDaySummary(trend, confidence, asset, change, price) {
  const direction = trend > 0 ? 'bullish' : 'bearish';
  const strength = confidence > 70 ? 'strong' : confidence > 50 ? 'moderate' : 'weak';
  const movePercent = Math.abs(change / price * 100).toFixed(2);
  
  const templates = {
    bullish: [
      `${asset.toUpperCase()} shows ${strength} bullish momentum. Expected +${movePercent}% move.`,
      `Buying opportunity with ${confidence.toFixed(0)}% confidence. Target: +${movePercent}%.`,
      `Technical patterns favor longs. ${strength} uptrend expected.`
    ],
    bearish: [
      `${asset.toUpperCase()} shows ${strength} bearish pressure. Expected -${movePercent}% move.`,
      `Selling pressure likely. Consider shorts or hedging.`,
      `Downward momentum detected. ${strength} decline expected.`
    ]
  };
  
  return templates[direction][Math.floor(Math.random() * templates[direction].length)];
}

// Run backtest simulation on forecast day
async function runForecastBacktest(dayIndex) {
  if (!forecastData.days || !forecastData.days[dayIndex]) return null;
  
  const day = forecastData.days[dayIndex];
  const hourlyPrices = day.predictedPrices;
  
  if (!hourlyPrices || hourlyPrices.length < 2) return null;
  
  // Create candle-like data from hourly prices
  const candles = hourlyPrices.map((close, i, arr) => ({
    time: i,
    open: i === 0 ? day.predictedOpen : arr[i-1],
    high: Math.max(close, i === 0 ? day.predictedOpen : arr[i-1]) * 1.002,
    low: Math.min(close, i === 0 ? day.predictedOpen : arr[i-1]) * 0.998,
    close
  }));
  
  // Simple backtest simulation with point-based P/L
  const settings = {
    initialCapital: parseFloat(document.getElementById('initialCapital')?.value) || 2000,
    positionSize: parseFloat(document.getElementById('backtestPositionSize')?.value) || 1, // $/point
    stopLoss: parseFloat(document.getElementById('stopLossPercent')?.value) || 2,
    takeProfit: parseFloat(document.getElementById('takeProfitPercent')?.value) || 5,
    orderFee: parseFloat(document.getElementById('orderFee')?.value) || 7
  };
  const pointValue = 0.01; // 1 point = $0.01 (1 cent)
  
  const trades = [];
  let capital = settings.initialCapital;
  let inPosition = false;
  let entryPrice = 0;
  let entryIdx = 0;
  
  for (let i = 2; i < candles.length - 1; i++) {
    const c = candles[i];
    const prev = candles[i-1];
    const prev2 = candles[i-2];
    
    if (!inPosition) {
      // Entry signal: momentum confirmation
      const momentum = (c.close - prev2.close) / prev2.close * 100;
      if (Math.abs(momentum) > 0.1) {
        inPosition = true;
        entryPrice = c.close;
        entryIdx = i;
        trades.push({
          type: momentum > 0 ? 'long' : 'short',
          entryIdx: i,
          entryPrice: c.close,
          entryTime: `Hour ${i}`
        });
      }
    } else {
      // Exit logic
      const trade = trades[trades.length - 1];
      const pnlPercent = trade.type === 'long' 
        ? (c.close - entryPrice) / entryPrice * 100
        : (entryPrice - c.close) / entryPrice * 100;
      
      const shouldExit = pnlPercent >= settings.takeProfit || 
                         pnlPercent <= -settings.stopLoss || 
                         i >= candles.length - 2;
      
      if (shouldExit) {
        trade.exitIdx = i;
        trade.exitPrice = c.close;
        trade.exitTime = `Hour ${i}`;
        // Point-based P/L calculation (same as forecast trade)
        const priceDiff = trade.type === 'long' ? (c.close - entryPrice) : (entryPrice - c.close);
        const priceDiffInPoints = priceDiff / pointValue; // Convert $ to points
        const grossPnl = priceDiffInPoints * settings.positionSize; // points × $/point
        trade.points = priceDiffInPoints;
        trade.pnl = grossPnl - settings.orderFee * 2; // Net P/L after fees
        trade.pnlPercent = pnlPercent;
        capital += trade.pnl;
        inPosition = false;
      }
    }
  }
  
  const completedTrades = trades.filter(t => t.exitPrice);
  const winningTrades = completedTrades.filter(t => t.pnl > 0);
  
  return {
    trades: completedTrades,
    totalPnL: completedTrades.reduce((sum, t) => sum + t.pnl, 0),
    winRate: completedTrades.length > 0 ? (winningTrades.length / completedTrades.length * 100) : 0,
    tradeCount: completedTrades.length
  };
}

async function updateForecastUI() {
  const container = document.getElementById('forecastCardsContainer');
  const outlookText = document.getElementById('forecastOutlookText');
  const accuracyScore = document.getElementById('forecastAccuracyScore');
  
  if (!forecastData.days || forecastData.days.length === 0) {
    if (container) container.innerHTML = '<div class="col-span-8 text-center py-8 text-gray-500">No forecast data available. Click Refresh to generate.</div>';
    return;
  }
  
  // Run backtest on each day
  for (let i = 0; i < forecastData.days.length; i++) {
    if (!forecastData.days[i].backtestResult) {
      forecastData.days[i].backtestResult = await runForecastBacktest(i);
    }
  }
  
  const bullishDays = forecastData.days.filter(d => d.direction === 'bullish').length;
  const bearishDays = forecastData.days.filter(d => d.direction === 'bearish').length;
  const totalDays = forecastData.days.length;
  const avgConfidence = forecastData.days.reduce((sum, d) => sum + d.confidence, 0) / totalDays;
  
  // Calculate total simulated P/L
  const totalSimPnL = forecastData.days.reduce((sum, d) => sum + (d.backtestResult?.totalPnL || 0), 0);
  
  if (outlookText) {
    const pnlStr = totalSimPnL >= 0 ? `+$${totalSimPnL.toFixed(2)}` : `-$${Math.abs(totalSimPnL).toFixed(2)}`;
    if (bullishDays > bearishDays) {
      outlookText.innerHTML = `<span class="text-green-600 dark:text-green-400">Bullish (${bullishDays}/${totalDays} days)</span> - Sim P/L: <span class="${totalSimPnL >= 0 ? 'text-green-600' : 'text-red-600'}">${pnlStr}</span>`;
    } else if (bearishDays > bullishDays) {
      outlookText.innerHTML = `<span class="text-red-600 dark:text-red-400">Bearish (${bearishDays}/${totalDays} days)</span> - Sim P/L: <span class="${totalSimPnL >= 0 ? 'text-green-600' : 'text-red-600'}">${pnlStr}</span>`;
    } else {
      outlookText.innerHTML = `<span class="text-yellow-600 dark:text-yellow-400">Mixed</span> - Sim P/L: <span class="${totalSimPnL >= 0 ? 'text-green-600' : 'text-red-600'}">${pnlStr}</span>`;
    }
    outlookText.className = 'text-lg font-semibold';
  }
  
  const avgAccuracy = forecastData.history.length > 0 
    ? forecastData.history.reduce((sum, h) => sum + (h.accuracy || 0), 0) / forecastData.history.length 
    : 0;
  if (accuracyScore) {
    accuracyScore.textContent = forecastData.history.length > 0 ? `${avgAccuracy.toFixed(0)}%` : '--%';
    accuracyScore.className = `text-lg font-bold ${avgAccuracy >= 60 ? 'text-green-600' : avgAccuracy >= 40 ? 'text-yellow-600' : 'text-red-600'}`;
  }
  
  if (container) {
    const now = new Date();
    const sydneyNow = toSydneyTime(now);
    const isMarketOpen = isTradingHours(now);
    
    container.innerHTML = forecastData.days.map((day, i) => {
      const date = new Date(day.date);
      const isYesterday = day.isHistorical;
      const isToday = day.isToday;
      const isFuture = day.isFuture;
      
      // Direction icon based on actual data
      let directionIcon = day.direction === 'bullish' ? '📈' : day.direction === 'bearish' ? '📉' : '➖';
      
      // Different color schemes for different day types
      let bgColor;
      if (isYesterday) {
        // Yesterday - muted colors (historical)
        bgColor = day.direction === 'bullish' 
          ? 'bg-green-50/50 dark:bg-green-900/10 border-green-200/50 dark:border-green-800/50' 
          : 'bg-red-50/50 dark:bg-red-900/10 border-red-200/50 dark:border-red-800/50';
      } else if (isToday) {
        // Today - bright with ring
        bgColor = day.direction === 'bullish' 
          ? 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700' 
          : 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700';
      } else {
        // Future - standard
        bgColor = day.direction === 'bullish' 
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' 
          : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
      }
      
      const bt = day.backtestResult;
      const btPnL = bt?.totalPnL || 0;
      const btTrades = bt?.tradeCount || 0;
      
      // Status badge
      let statusBadge = '';
      if (isYesterday) {
        statusBadge = '<span class="inline-block mt-1 px-1.5 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">HISTORICAL</span>';
      } else if (isToday) {
        if (isMarketOpen) {
          statusBadge = '<span class="inline-block mt-1 px-1.5 py-0.5 text-xs bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 rounded animate-pulse">LIVE</span>';
        } else {
          statusBadge = '<span class="inline-block mt-1 px-1.5 py-0.5 text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-600 dark:text-yellow-300 rounded">TODAY</span>';
        }
      } else if (isFuture) {
        statusBadge = '<span class="inline-block mt-1 px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 rounded">FORECAST</span>';
      }
      
      // Format the percentage
      const expectedMove = parseFloat(day.expectedMove) || 0;
      const moveStr = expectedMove >= 0 ? `+${expectedMove.toFixed(2)}%` : `${expectedMove.toFixed(2)}%`;
      const moveColor = expectedMove >= 0 ? 'text-green-600' : 'text-red-600';
      
      // Label for the day
      let dayLabel = day.dayName;
      if (isYesterday) dayLabel = 'Yesterday';
      else if (isToday) dayLabel = 'Today';
      
      return `
        <div class="forecast-day-card cursor-pointer p-3 rounded-lg border ${bgColor} ${isToday ? 'ring-2 ring-blue-500' : ''} hover:shadow-lg transition-all" data-day-index="${i}">
          <div class="text-center">
            <p class="text-xs font-medium ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}">${dayLabel}</p>
            <p class="text-xs text-gray-400">${toSydneyTime(date).getDate()}/${toSydneyTime(date).getMonth() + 1}</p>
            <div class="text-2xl my-1">${directionIcon}</div>
            <div class="h-12 mb-1" id="miniChart${i}"></div>
            <p class="text-sm font-bold ${moveColor}">${moveStr}</p>
            ${!isYesterday && !isToday ? `<p class="text-xs text-gray-500">${(day.confidence || 0).toFixed(0)}% conf</p>` : ''}
            ${btTrades > 0 && !isYesterday ? `<p class="text-xs mt-1 ${btPnL >= 0 ? 'text-green-600' : 'text-red-600'}">${btPnL >= 0 ? '+' : ''}$${btPnL.toFixed(0)} (${btTrades} trades)</p>` : ''}
            ${statusBadge}
          </div>
          <p class="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">${day.summary || ''}</p>
        </div>
      `;
    }).join('');
    
    // Add market status header
    const marketStatusDiv = document.getElementById('forecastMarketStatus');
    if (marketStatusDiv) {
      if (isMarketOpen) {
        marketStatusDiv.innerHTML = `<span class="text-green-600">Market Open</span> - Sydney: ${sydneyNow.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })} AEDT`;
      } else {
        const nextSession = getNextTradingSession(now);
        marketStatusDiv.innerHTML = `<span class="text-red-600">Market Closed</span> - Opens: ${formatSydneyTime(nextSession, 'date')} ${formatSydneyTime(nextSession)}`;
      }
    }
    
    container.querySelectorAll('.forecast-day-card').forEach(card => {
      card.addEventListener('click', () => {
        const dayIndex = parseInt(card.dataset.dayIndex);
        showDayDetails(dayIndex);
      });
    });
    
    setTimeout(() => renderMiniCharts(), 100);
  }
}

function renderMiniCharts() {
  // Calculate global min/max across all days for consistent scale
  let globalMin = Infinity;
  let globalMax = -Infinity;
  
  forecastData.days.forEach(day => {
    const predicted = day.predictedPrices || [];
    const actual = day.actualPrices || [];
    const allPrices = [...predicted, ...actual].filter(p => p != null);
    if (allPrices.length > 0) {
      globalMin = Math.min(globalMin, ...allPrices);
      globalMax = Math.max(globalMax, ...allPrices);
    }
  });
  
  const globalRange = globalMax - globalMin || 1;
  
  forecastData.days.forEach((day, i) => {
    const container = document.getElementById(`miniChart${i}`);
    if (!container) return;
    
    const predicted = day.predictedPrices || [];
    const actual = day.actualPrices || [];
    const currentPrice = day.currentPrice;
    const isToday = i === 0;
    
    if (predicted.length === 0) return;
    
    const width = container.clientWidth || 60;
    const height = 48;
    
    // Use global scale for consistency across days
    let predictedPath = '';
    predicted.forEach((p, j) => {
      const x = (j / (predicted.length - 1)) * width;
      const y = height - ((p - globalMin) / globalRange) * height;
      predictedPath += j === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });
    
    let actualPath = '';
    if (actual.length > 0) {
      actual.forEach((p, j) => {
        const x = (j / (actual.length - 1)) * width;
        const y = height - ((p - globalMin) / globalRange) * height;
        actualPath += j === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
      });
    }
    
    // Draw connection point from previous day if exists
    let connectorCircle = '';
    if (i > 0) {
      const prevDay = forecastData.days[i - 1];
      const prevClose = prevDay.predictedClose;
      const currOpen = day.predictedOpen;
      // Small dot at start showing continuity
      const startY = height - ((currOpen - globalMin) / globalRange) * height;
      connectorCircle = `<circle cx="0" cy="${startY}" r="2" fill="#60a5fa"/>`;
    }
    
    // Current price marker (red dot with line) for today only
    let currentPriceMarker = '';
    if (isToday && currentPrice) {
      const cpY = height - ((currentPrice - globalMin) / globalRange) * height;
      currentPriceMarker = `
        <line x1="0" y1="${cpY}" x2="${width}" y2="${cpY}" stroke="#ef4444" stroke-width="1" stroke-dasharray="2,2"/>
        <circle cx="${width - 4}" cy="${cpY}" r="3" fill="#ef4444" stroke="white" stroke-width="1"/>
      `;
    }
    
    container.innerHTML = `
      <svg width="${width}" height="${height}" class="w-full h-full">
        ${connectorCircle}
        <path d="${predictedPath}" fill="none" stroke="#3b82f6" stroke-width="1.5" />
        ${actualPath ? `<path d="${actualPath}" fill="none" stroke="#f97316" stroke-width="1.5" />` : ''}
        ${currentPriceMarker}
      </svg>
    `;
  });
}

let currentDetailDayIndex = 0;

async function showDayDetails(dayIndex) {
  const day = forecastData.days[dayIndex];
  if (!day) return;
  
  currentDetailDayIndex = dayIndex;
  const isToday = dayIndex === 0;
  
  // Fetch fresh real price data for today
  if (isToday) {
    try {
      const asset = forecastData.asset || 'silver';
      const response = await fetch(`/api/market-data/${asset}/1h`);
      if (response.ok) {
        const data = await response.json();
        const allCandles = data.candles || [];
        
        // Filter to only today's candles (since midnight local time)
        const todayMidnight = new Date();
        todayMidnight.setHours(0, 0, 0, 0);
        const midnightTs = Math.floor(todayMidnight.getTime() / 1000);
        
        const todayCandles = allCandles.filter(c => c.time >= midnightTs);
        
        if (todayCandles.length > 0) {
          day.actualCandles = todayCandles.map(c => ({
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            time: c.time
          }));
          day.actualPrices = todayCandles.map(c => c.close);
          day.currentPrice = todayCandles[todayCandles.length - 1]?.close;
        }
      }
    } catch (e) {
      console.warn('Failed to fetch real price data:', e);
    }
  }
  
  const detailsEl = document.getElementById('forecastDayDetails');
  if (!detailsEl) return;
  
  detailsEl.classList.remove('hidden');
  
  const date = new Date(day.date);
  const sydneyDate = toSydneyTime(date);
  
  document.getElementById('forecastDayTitle').textContent = `${day.dayName}, ${sydneyDate.getDate()}/${sydneyDate.getMonth() + 1} (AEDT)`;
  
  // Show/hide current price bar and update button for today only
  const currentPriceBar = document.getElementById('forecastCurrentPriceBar');
  const updateBtn = document.getElementById('updateDayPredictionBtn');
  
  if (isToday) {
    // Always show update button for today
    if (updateBtn) updateBtn.classList.remove('hidden');
    
    if (day.currentPrice) {
      if (currentPriceBar) {
        currentPriceBar.classList.remove('hidden');
        document.getElementById('forecastCurrentPriceValue').textContent = `$${day.currentPrice.toFixed(2)}`;
      }
    } else {
      // Hide price bar if no current price yet, but keep button visible
      if (currentPriceBar) currentPriceBar.classList.add('hidden');
    }
  } else {
    if (currentPriceBar) currentPriceBar.classList.add('hidden');
    if (updateBtn) updateBtn.classList.add('hidden');
  }
  document.getElementById('forecastEntryPrice').textContent = `$${day.entryPrice.toFixed(2)}`;
  document.getElementById('forecastEntryTime').textContent = day.entryTime;
  document.getElementById('forecastExitPrice').textContent = `$${day.exitPrice.toFixed(2)}`;
  document.getElementById('forecastExitTime').textContent = day.exitTime;
  document.getElementById('forecastDirection').textContent = day.direction === 'bullish' ? '📈 Bullish' : '📉 Bearish';
  document.getElementById('forecastDirection').className = `text-lg font-bold ${day.direction === 'bullish' ? 'text-green-600' : 'text-red-600'}`;
  document.getElementById('forecastConfidence').textContent = `${day.confidence.toFixed(0)}%`;
  document.getElementById('forecastExpectedMove').textContent = `${parseFloat(day.expectedMove) > 0 ? '+' : ''}${day.expectedMove}%`;
  document.getElementById('forecastExpectedMove').className = `text-lg font-bold ${parseFloat(day.expectedMove) >= 0 ? 'text-green-600' : 'text-red-600'}`;
  document.getElementById('forecastNaturalSummary').textContent = day.summary;
  
  // Display AI suggested trades (multiple, future only)
  const suggestedTradesSection = document.getElementById('forecastSuggestedTradesSection');
  const suggestedTradesList = document.getElementById('forecastSuggestedTradesList');
  const tradeCountEl = document.getElementById('forecastTradeCount');
  
  if (suggestedTradesSection && suggestedTradesList) {
    const trades = day.suggestedTrades || [];
    if (trades.length > 0 && isToday) {
      suggestedTradesSection.classList.remove('hidden');
      tradeCountEl.textContent = `${trades.length} trade${trades.length > 1 ? 's' : ''}`;
      
      suggestedTradesList.innerHTML = trades.map((trade, idx) => {
        const isLong = trade.direction === 'LONG';
        const dirIcon = isLong ? '📈' : '📉';
        const bgClass = isLong 
          ? 'bg-gradient-to-r from-green-50 to-green-100 dark:from-green-900/30 dark:to-green-800/30 border-green-200 dark:border-green-700'
          : 'bg-gradient-to-r from-red-50 to-red-100 dark:from-red-900/30 dark:to-red-800/30 border-red-200 dark:border-red-700';
        const titleClass = isLong ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300';
        const pnlClass = isLong ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
        return `
          <div class="p-2 ${bgClass} rounded-lg border text-xs">
            <div class="flex items-center justify-between mb-1">
              <span class="font-bold ${titleClass}">${dirIcon} Trade ${idx + 1}: ${trade.direction}</span>
              <span class="text-purple-600 dark:text-purple-400 font-medium">${trade.confidence?.toFixed(0) || 70}% conf</span>
            </div>
            <div class="grid grid-cols-4 gap-2 text-gray-600 dark:text-gray-300">
              <div><span class="text-gray-400">Entry:</span> $${trade.entryPrice?.toFixed(2) || '--'}</div>
              <div><span class="text-gray-400">@</span> ${trade.entryTime || '--'}</div>
              <div><span class="text-gray-400">Exit:</span> $${trade.exitPrice?.toFixed(2) || '--'}</div>
              <div><span class="text-gray-400">@</span> ${trade.exitTime || '--'}</div>
            </div>
            <div class="mt-1 ${pnlClass} font-medium">Expected P/L: ${trade.expectedPnL || '--'}</div>
          </div>
        `;
      }).join('');
    } else {
      suggestedTradesSection.classList.add('hidden');
    }
  }
  
  // Show detailed trade information (from Backtest Simulation settings)
  const tradeInfoEl = document.getElementById('forecastBacktestResults');
  if (tradeInfoEl) {
    const trade = day.trade;
    const brainMeta = day.brainMetadata;
    const bt = day.backtestResult;
    
    let tradeHtml = '';
    
    // Show AI-predicted trade details
    if (trade) {
      const pnlClass = trade.netPnL >= 0 ? 'text-green-600' : 'text-red-600';
      tradeHtml += `
        <div class="mt-3 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-lg border border-blue-200 dark:border-blue-700">
          <h4 class="font-semibold text-sm mb-2 text-blue-700 dark:text-blue-300">📊 Forecast Trade (using Backtest Settings)</h4>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div>
              <span class="text-gray-500">Direction:</span>
              <span class="font-bold ${trade.direction === 'LONG' ? 'text-green-600' : 'text-red-600'}">${trade.direction}</span>
            </div>
            <div>
              <span class="text-gray-500">Position:</span>
              <span class="font-bold">${trade.positionSize.toFixed(2)} units</span>
            </div>
            <div>
              <span class="text-gray-500">Capital Used:</span>
              <span class="font-bold">$${trade.capitalUsed.toFixed(2)}</span>
            </div>
            <div>
              <span class="text-gray-500">Account:</span>
              <span class="font-bold">$${trade.capital.toLocaleString()}</span>
            </div>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm mt-2">
            <div>
              <span class="text-gray-500">Entry:</span>
              <span class="font-bold">$${trade.entryPrice.toFixed(2)}</span>
            </div>
            <div>
              <span class="text-gray-500">Exit:</span>
              <span class="font-bold">$${trade.exitPrice.toFixed(2)}</span>
            </div>
            <div>
              <span class="text-gray-500">Points:</span>
              <span class="font-bold ${pnlClass}">${trade.points >= 0 ? '+' : ''}${trade.points.toFixed(0)}</span>
            </div>
            <div>
              <span class="text-gray-500">Gross P/L:</span>
              <span class="font-bold ${pnlClass}">${trade.grossPnL >= 0 ? '+' : ''}$${trade.grossPnL.toFixed(2)}</span>
            </div>
            <div>
              <span class="text-gray-500">Net P/L:</span>
              <span class="font-bold ${pnlClass}">${trade.netPnL >= 0 ? '+' : ''}$${trade.netPnL.toFixed(2)}</span>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2 text-xs mt-2 text-gray-500">
            <div>Fees: $${trade.fees.toFixed(2)}</div>
            <div>Spread: $${trade.spreadCost.toFixed(2)}</div>
            <div>Return: <span class="${pnlClass} font-medium">${trade.returnPct >= 0 ? '+' : ''}${trade.returnPct.toFixed(2)}%</span></div>
          </div>
        </div>
      `;
    }
    
    // Show AI Brain metadata
    if (brainMeta) {
      tradeHtml += `
        <div class="mt-2 p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg text-xs">
          <span class="font-medium text-purple-700 dark:text-purple-300">🧠 AI Brain:</span>
          <span class="text-gray-600 dark:text-gray-400">
            Bias: ${brainMeta.patternBias} | 
            Correction: ${brainMeta.previousCorrection} | 
            Session: ${brainMeta.bestSession} | 
            Patterns: ${brainMeta.totalPatternsUsed} |
            Recent: ${brainMeta.recentAccuracy || 'N/A'} |
            Accuracy: ${brainMeta.assetAccuracy || 'N/A'}
          </span>
        </div>
      `;
    }
    
    // Show backtest simulation results if available
    if (bt && bt.tradeCount > 0) {
      tradeHtml += `
        <div class="mt-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h4 class="font-semibold text-xs mb-2">Backtest Simulation</h4>
          <div class="grid grid-cols-3 gap-2 text-sm">
            <div>
              <span class="text-gray-500">P/L:</span>
              <span class="${bt.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'} font-bold">${bt.totalPnL >= 0 ? '+' : ''}$${bt.totalPnL.toFixed(2)}</span>
            </div>
            <div>
              <span class="text-gray-500">Win Rate:</span>
              <span class="${bt.winRate >= 50 ? 'text-green-600' : 'text-red-600'} font-bold">${bt.winRate.toFixed(0)}%</span>
            </div>
            <div>
              <span class="text-gray-500">Trades:</span>
              <span class="font-bold">${bt.tradeCount}</span>
            </div>
          </div>
        </div>
      `;
    }
    
    tradeInfoEl.innerHTML = tradeHtml || '<div class="mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"><p class="text-sm text-gray-500">No trade data available</p></div>';
  }
  
  // Show price continuity info
  const priceInfoEl = document.getElementById('forecastPriceInfo');
  if (priceInfoEl) {
    priceInfoEl.innerHTML = `
      <div class="grid grid-cols-4 gap-2 text-xs mt-2">
        <div><span class="text-gray-500">Open:</span> $${day.predictedOpen.toFixed(2)}</div>
        <div><span class="text-gray-500">High:</span> $${day.predictedHigh.toFixed(2)}</div>
        <div><span class="text-gray-500">Low:</span> $${day.predictedLow.toFixed(2)}</div>
        <div><span class="text-gray-500">Close:</span> $${day.predictedClose.toFixed(2)}</div>
      </div>
    `;
  }
  
  renderDayChart(day, dayIndex);
}

// Interval for forecast day chart price updates
let forecastDayPriceInterval = null;

function renderDayChart(day, dayIndex) {
  const container = document.getElementById('forecastDayChart');
  if (!container) return;
  
  const predicted = day.predictedPrices || [];
  const actual = day.actualPrices || [];
  const actualCandles = day.actualCandles || [];
  const currentPrice = day.currentPrice;
  const isToday = dayIndex === 0;
  
  // Collect all prices for scale calculation
  const allPrices = [...predicted, ...actual].filter(p => p != null);
  if (currentPrice) allPrices.push(currentPrice);
  
  // Include candle highs/lows in scale
  actualCandles.forEach(c => {
    if (c.high) allPrices.push(c.high);
    if (c.low) allPrices.push(c.low);
  });
  
  if (allPrices.length === 0) {
    container.innerHTML = '<div class="flex items-center justify-center h-full text-gray-500 text-sm">No price data</div>';
    return;
  }
  
  const min = Math.min(...allPrices) * 0.998;
  const max = Math.max(...allPrices) * 1.002;
  const range = max - min || 1;
  
  const width = container.clientWidth || 500;
  const height = parseInt(document.getElementById('forecastDayChartHeight')?.value) || 320;
  container.style.height = `${height}px`;
  
  // Increased padding for axes
  const paddingLeft = 70;
  const paddingRight = 100;
  const paddingTop = 30;
  const paddingBottom = 50;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  
  // Always show full 24h chart from 00:00 to 24:00
  const chartStartHour = 0;
  const chartEndHour = 24;
  const totalChartHours = 24;
  
  // === GRID LINES ===
  let gridLines = '';
  const numHorizontalLines = 5;
  for (let i = 0; i <= numHorizontalLines; i++) {
    const y = paddingTop + (i / numHorizontalLines) * chartHeight;
    gridLines += `<line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="#374151" stroke-width="1" stroke-opacity="0.3"/>`;
  }
  
  // Vertical grid lines (every 4 hours)
  const numVerticalLines = 6; // 0, 4, 8, 12, 16, 20, 24
  for (let i = 0; i <= numVerticalLines; i++) {
    const x = paddingLeft + (i / numVerticalLines) * chartWidth;
    gridLines += `<line x1="${x}" y1="${paddingTop}" x2="${x}" y2="${height - paddingBottom}" stroke="#374151" stroke-width="1" stroke-opacity="0.3"/>`;
  }
  
  // === Y-AXIS (Price) ===
  let yAxisLabels = '';
  for (let i = 0; i <= numHorizontalLines; i++) {
    const y = paddingTop + (i / numHorizontalLines) * chartHeight;
    const price = max - (i / numHorizontalLines) * range;
    yAxisLabels += `<text x="${paddingLeft - 8}" y="${y + 4}" fill="#9ca3af" font-size="11" text-anchor="end" font-family="monospace">$${price.toFixed(2)}</text>`;
  }
  // Y-axis line
  yAxisLabels += `<line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${height - paddingBottom}" stroke="#6b7280" stroke-width="1"/>`;
  yAxisLabels += `<text x="${15}" y="${height / 2}" fill="#9ca3af" font-size="11" text-anchor="middle" transform="rotate(-90, 15, ${height / 2})">Price (USD)</text>`;
  
  // === X-AXIS (Time) - Fixed 24h from 00:00 to 24:00 ===
  let xAxisLabels = '';
  const timeLabels = [0, 4, 8, 12, 16, 20, 24];
  for (let i = 0; i < timeLabels.length; i++) {
    const x = paddingLeft + (timeLabels[i] / 24) * chartWidth;
    const timeStr = `${timeLabels[i].toString().padStart(2, '0')}:00`;
    xAxisLabels += `<text x="${x}" y="${height - paddingBottom + 18}" fill="#9ca3af" font-size="10" text-anchor="middle" font-family="monospace">${timeStr}</text>`;
  }
  // X-axis line
  xAxisLabels += `<line x1="${paddingLeft}" y1="${height - paddingBottom}" x2="${width - paddingRight}" y2="${height - paddingBottom}" stroke="#6b7280" stroke-width="1"/>`;
  xAxisLabels += `<text x="${paddingLeft + chartWidth / 2}" y="${height - 8}" fill="#9ca3af" font-size="11" text-anchor="middle">Time (AEDT)</text>`;
  
  // Helper: Map hour (0-24) to X coordinate
  const hourToX = (hour) => {
    return paddingLeft + (hour / 24) * chartWidth;
  };
  
  // Helper: Map actual timestamp to X coordinate (based on hour of day, 0-24)
  const timeToX = (timestamp) => {
    const date = new Date(timestamp * 1000);
    const hour = date.getHours();
    const minute = date.getMinutes();
    const hourDecimal = hour + minute / 60;
    return paddingLeft + (hourDecimal / 24) * chartWidth;
  };
  
  // === PREDICTED LINE (blue) ===
  let predictedPath = '';
  const now = new Date();
  const currentHourDecimal = now.getHours() + now.getMinutes() / 60;
  
  // For today: prediction starts from current time to 24:00
  // For past/future days: prediction spans full 00:00 to 24:00
  const predictionStartHour = isToday ? currentHourDecimal : 0;
  const predictionEndHour = 24;
  const predictionSpan = predictionEndHour - predictionStartHour;
  
  predicted.forEach((p, j) => {
    const hourOffset = (j / (predicted.length - 1 || 1)) * predictionSpan;
    const predictedHour = predictionStartHour + hourOffset;
    const x = paddingLeft + (predictedHour / 24) * chartWidth;
    const y = paddingTop + ((max - p) / range) * chartHeight;
    predictedPath += j === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  });
  
  // === REAL PRICE LINE (red) - from actualCandles, TIME-ALIGNED ===
  let realPricePath = '';
  let lastRealX = paddingLeft;
  let lastRealY = paddingTop + chartHeight / 2;
  
  if (actualCandles.length > 0) {
    // Sort candles by time and map to chart positions
    const sortedCandles = actualCandles
      .filter(c => c.time != null)
      .sort((a, b) => a.time - b.time);
    
    if (sortedCandles.length > 0) {
      sortedCandles.forEach((c, j) => {
        // Map candle time to X position within 24h chart (use local hour)
        const candleDate = new Date(c.time * 1000);
        const hourDecimal = candleDate.getHours() + candleDate.getMinutes() / 60;
        const x = paddingLeft + (hourDecimal / 24) * chartWidth;
        const y = paddingTop + ((max - c.close) / range) * chartHeight;
        realPricePath += j === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
        lastRealX = x;
        lastRealY = y;
      });
    } else {
      // Fallback: candles have no timestamps, spread based on index (assuming 1 per hour)
      actualCandles.forEach((c, j) => {
        const hourDecimal = j; // Each candle represents ~1 hour
        const x = paddingLeft + (hourDecimal / 24) * chartWidth;
        const y = paddingTop + ((max - c.close) / range) * chartHeight;
        realPricePath += j === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
        lastRealX = x;
        lastRealY = y;
      });
    }
  } else if (actual.length > 0) {
    // Use actualPrices array - spread by index (assuming 1 per hour)
    actual.forEach((p, j) => {
      const hourDecimal = j;
      const x = paddingLeft + (hourDecimal / 24) * chartWidth;
      const y = paddingTop + ((max - p) / range) * chartHeight;
      realPricePath += j === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
      lastRealX = x;
      lastRealY = y;
    });
  }
  
  // === CURRENT PRICE DOT (blinking yellow 4px) ===
  let currentPriceDot = '';
  if (isToday && currentPrice) {
    // Position at the last actual candle's time position (not chart edge)
    const dotX = lastRealX;
    const dotY = paddingTop + ((max - currentPrice) / range) * chartHeight;
    
    currentPriceDot = `
      <circle cx="${dotX}" cy="${dotY}" r="4" fill="#fbbf24" class="forecast-price-dot">
        <animate attributeName="opacity" values="1;0.4;1" dur="0.8s" repeatCount="indefinite"/>
      </circle>
      <rect x="${dotX + 8}" y="${dotY - 10}" width="60" height="20" fill="#fbbf24" rx="3"/>
      <text x="${dotX + 38}" y="${dotY + 4}" fill="#1f2937" font-size="11" text-anchor="middle" font-weight="bold">$${currentPrice.toFixed(2)}</text>
    `;
  }
  
  // === TRADE MARKERS (time-aligned) ===
  let tradeMarkers = '';
  const bt = day.backtestResult;
  if (bt && bt.trades.length > 0) {
    bt.trades.forEach(trade => {
      // Use hour-based positioning if available, otherwise use index-based with prediction alignment
      let entryX, exitX;
      if (trade.entryHour != null && trade.exitHour != null) {
        entryX = paddingLeft + (trade.entryHour / 24) * chartWidth;
        exitX = paddingLeft + (trade.exitHour / 24) * chartWidth;
      } else {
        // Fallback: align with prediction line positioning
        const entryHourOffset = (trade.entryIdx / (predicted.length - 1 || 1)) * predictionSpan;
        const exitHourOffset = (trade.exitIdx / (predicted.length - 1 || 1)) * predictionSpan;
        entryX = paddingLeft + ((predictionStartHour + entryHourOffset) / 24) * chartWidth;
        exitX = paddingLeft + ((predictionStartHour + exitHourOffset) / 24) * chartWidth;
      }
      const entryY = paddingTop + ((max - trade.entryPrice) / range) * chartHeight;
      const exitY = paddingTop + ((max - trade.exitPrice) / range) * chartHeight;
      
      const color = trade.pnl >= 0 ? '#10b981' : '#ef4444';
      tradeMarkers += `
        <line x1="${entryX}" y1="${entryY}" x2="${exitX}" y2="${exitY}" stroke="${color}" stroke-width="2" stroke-dasharray="4,3"/>
        <circle cx="${entryX}" cy="${entryY}" r="5" fill="#3b82f6" stroke="white" stroke-width="2"/>
        <circle cx="${exitX}" cy="${exitY}" r="5" fill="${color}" stroke="white" stroke-width="2"/>
      `;
    });
  }
  
  // === SUGGESTED TRADE MARKERS (future trades from AI, aligned with prediction line) ===
  const suggestedTrades = day.suggestedTrades || [];
  if (isToday && suggestedTrades.length > 0) {
    suggestedTrades.forEach((trade, idx) => {
      // Use prediction index for X positioning to align with prediction line
      let entryX, exitX, entryY, exitY;
      
      if (trade.entryIdx != null && trade.exitIdx != null && predicted.length > 0) {
        // Index-based positioning aligned with prediction line
        const entryHourOffset = (trade.entryIdx / (predicted.length - 1 || 1)) * predictionSpan;
        const exitHourOffset = (trade.exitIdx / (predicted.length - 1 || 1)) * predictionSpan;
        entryX = paddingLeft + ((predictionStartHour + entryHourOffset) / 24) * chartWidth;
        exitX = paddingLeft + ((predictionStartHour + exitHourOffset) / 24) * chartWidth;
        // Use prediction values at those indices for Y (ensures alignment)
        const entryPredPrice = predicted[trade.entryIdx] || trade.entryPrice;
        const exitPredPrice = predicted[trade.exitIdx] || trade.exitPrice;
        entryY = paddingTop + ((max - entryPredPrice) / range) * chartHeight;
        exitY = paddingTop + ((max - exitPredPrice) / range) * chartHeight;
      } else {
        // Fallback to hour-based positioning
        const entryHour = trade.entryHour || parseInt(trade.entryTime?.split(':')[0]) || 0;
        const exitHour = trade.exitHour || parseInt(trade.exitTime?.split(':')[0]) || 0;
        entryX = paddingLeft + (entryHour / 24) * chartWidth;
        exitX = paddingLeft + (exitHour / 24) * chartWidth;
        entryY = paddingTop + ((max - trade.entryPrice) / range) * chartHeight;
        exitY = paddingTop + ((max - trade.exitPrice) / range) * chartHeight;
      }
      
      const color = trade.direction === 'LONG' ? '#22c55e' : '#f97316';
      tradeMarkers += `
        <line x1="${entryX}" y1="${entryY}" x2="${exitX}" y2="${exitY}" stroke="${color}" stroke-width="2" stroke-dasharray="6,3" opacity="0.8"/>
        <circle cx="${entryX}" cy="${entryY}" r="6" fill="${color}" stroke="white" stroke-width="2" opacity="0.9">
          <title>Trade ${idx + 1}: ${trade.direction} Entry @ ${trade.entryTime}</title>
        </circle>
        <circle cx="${exitX}" cy="${exitY}" r="6" fill="${color}" stroke="white" stroke-width="2" opacity="0.9">
          <title>Trade ${idx + 1}: Exit @ ${trade.exitTime}</title>
        </circle>
        <text x="${entryX}" y="${entryY - 10}" fill="${color}" font-size="9" text-anchor="middle" font-weight="bold">${idx + 1}</text>
      `;
    });
  }
  
  // === LEGEND BOX ===
  const legendX = width - paddingRight + 10;
  let legendY = paddingTop + 10;
  let legendItems = `
    <rect x="${legendX - 5}" y="${legendY - 8}" width="90" height="${isToday && currentPrice ? 85 : 55}" fill="#1f2937" fill-opacity="0.9" rx="4" stroke="#374151"/>
    <text x="${legendX}" y="${legendY + 5}" fill="#d1d5db" font-size="10" font-weight="bold">LEGEND</text>
  `;
  legendY += 18;
  
  // Predicted
  legendItems += `<line x1="${legendX}" y1="${legendY}" x2="${legendX + 15}" y2="${legendY}" stroke="#3b82f6" stroke-width="2"/>`;
  legendItems += `<text x="${legendX + 20}" y="${legendY + 4}" fill="#9ca3af" font-size="10">Predicted</text>`;
  legendY += 16;
  
  // Actual/Real
  if (realPricePath) {
    legendItems += `<line x1="${legendX}" y1="${legendY}" x2="${legendX + 15}" y2="${legendY}" stroke="#ef4444" stroke-width="2"/>`;
    legendItems += `<text x="${legendX + 20}" y="${legendY + 4}" fill="#9ca3af" font-size="10">Actual</text>`;
    legendY += 16;
  }
  
  // Current Price
  if (isToday && currentPrice) {
    legendItems += `<circle cx="${legendX + 7}" cy="${legendY}" r="4" fill="#fbbf24"/>`;
    legendItems += `<text x="${legendX + 20}" y="${legendY + 4}" fill="#9ca3af" font-size="10">Current</text>`;
    legendY += 16;
  }
  
  // Trades
  if (bt && bt.trades.length > 0) {
    legendItems += `<circle cx="${legendX + 7}" cy="${legendY}" r="4" fill="#10b981"/>`;
    legendItems += `<text x="${legendX + 20}" y="${legendY + 4}" fill="#9ca3af" font-size="10">Trades</text>`;
  }
  
  // === RENDER SVG ===
  container.innerHTML = `
    <svg width="${width}" height="${height}" class="w-full h-full" style="background: #111827; border-radius: 8px;">
      <defs>
        <linearGradient id="predictedAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.2"/>
          <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
        </linearGradient>
      </defs>
      
      <!-- Grid -->
      ${gridLines}
      
      <!-- Axes -->
      ${yAxisLabels}
      ${xAxisLabels}
      
      <!-- Predicted Line -->
      ${predictedPath ? `<path d="${predictedPath}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      
      <!-- Real Price Line (red) -->
      ${realPricePath ? `<path d="${realPricePath}" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      
      <!-- Trade Markers -->
      ${tradeMarkers}
      
      <!-- Current Price Dot (blinking yellow) -->
      ${currentPriceDot}
      
      <!-- Legend -->
      ${legendItems}
    </svg>
  `;
  
  // Start 30-second price updates for today's chart
  if (isToday) {
    startForecastDayPriceUpdates(dayIndex);
  }
}

// 30-second current price update for forecast day chart
function startForecastDayPriceUpdates(dayIndex) {
  if (forecastDayPriceInterval) {
    clearInterval(forecastDayPriceInterval);
  }
  
  forecastDayPriceInterval = setInterval(async () => {
    if (!forecastData.days || forecastData.days.length === 0) return;
    const forecastTab = document.getElementById('forecastTab');
    if (!forecastTab || forecastTab.classList.contains('hidden')) return;
    
    try {
      const day = forecastData.days[dayIndex];
      if (!day) return;
      
      const asset = forecastData.asset || 'silver';
      const response = await fetch(`/api/market-data/${asset}/1h`);
      if (!response.ok) return;
      
      const data = await response.json();
      const allCandles = data.candles || [];
      if (allCandles.length === 0) return;
      
      // Filter to only today's candles (since midnight local time)
      const todayMidnight = new Date();
      todayMidnight.setHours(0, 0, 0, 0);
      const midnightTs = Math.floor(todayMidnight.getTime() / 1000);
      
      const todayCandles = allCandles.filter(c => c.time >= midnightTs);
      if (todayCandles.length === 0) return;
      
      // Get latest price
      const latestPrice = todayCandles[todayCandles.length - 1]?.close;
      if (latestPrice && latestPrice !== day.currentPrice) {
        day.currentPrice = latestPrice;
        
        // Use today's hourly candles only
        day.actualCandles = todayCandles.map(c => ({
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          time: c.time
        }));
        day.actualPrices = todayCandles.map(c => c.close);
        
        // Re-render chart with updated data
        renderDayChart(day, dayIndex);
        
        // Update current price display
        const priceValueEl = document.getElementById('forecastCurrentPriceValue');
        if (priceValueEl) {
          priceValueEl.textContent = `$${latestPrice.toFixed(2)}`;
        }
        
        console.log(`Forecast day chart updated: $${latestPrice.toFixed(2)}`);
      }
    } catch (e) {
      console.warn('Forecast day price update failed:', e);
    }
  }, 30000); // 30 seconds
}

function checkAndRotateForecast() {
  if (!forecastData.days || forecastData.days.length === 0) return;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const firstDayDate = new Date(forecastData.days[0].date);
  firstDayDate.setHours(0, 0, 0, 0);
  
  if (today > firstDayDate) {
    const expiredDay = forecastData.days.shift();
    
    if (expiredDay.actualPrices && expiredDay.actualPrices.length > 0) {
      const actualClose = expiredDay.actualPrices[expiredDay.actualPrices.length - 1];
      const predictedClose = expiredDay.predictedClose;
      const error = Math.abs(actualClose - predictedClose) / predictedClose * 100;
      const accuracy = Math.max(0, 100 - error * 5);
      const directionCorrect = (expiredDay.direction === 'bullish' && actualClose > expiredDay.predictedOpen) ||
                               (expiredDay.direction === 'bearish' && actualClose < expiredDay.predictedOpen);
      
      forecastData.history.push({
        date: expiredDay.date,
        predictedDirection: expiredDay.direction,
        actualDirection: actualClose > expiredDay.predictedOpen ? 'bullish' : 'bearish',
        predictedClose,
        actualClose,
        accuracy,
        directionCorrect
      });
      
      fetch('/api/ai-memory/brain/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'forecast_accuracy',
          data: forecastData.history[forecastData.history.length - 1]
        })
      }).catch(console.warn);
    }
    
    const lastDay = forecastData.days[forecastData.days.length - 1];
    const newDate = new Date(lastDay.date);
    newDate.setDate(newDate.getDate() + 1);
    
    forecastData.days.push({
      date: newDate.toISOString(),
      dayName: newDate.toLocaleDateString('en-US', { weekday: 'short' }),
      direction: Math.random() > 0.5 ? 'bullish' : 'bearish',
      confidence: 50 + Math.random() * 30,
      predictedOpen: lastDay.predictedClose,
      predictedHigh: lastDay.predictedClose * 1.02,
      predictedLow: lastDay.predictedClose * 0.98,
      predictedClose: lastDay.predictedClose * (1 + (Math.random() - 0.5) * 0.04),
      expectedMove: ((Math.random() - 0.5) * 4).toFixed(2),
      entryPrice: lastDay.predictedClose,
      exitPrice: lastDay.predictedClose * 1.01,
      entryTime: '09:00',
      exitTime: '16:00',
      summary: 'Forecast will be updated with fresh analysis.',
      predictedPrices: [],
      actualPrices: []
    });
    
    saveForecastToStorage();
    updateForecastUI();
    updateForecastHistory();
  }
}

function updateForecastHistory() {
  const container = document.getElementById('forecastHistoryList');
  const countEl = document.getElementById('forecastHistoryCount');
  
  if (!container) return;
  
  const history = forecastData.history || [];
  
  if (countEl) countEl.textContent = `${history.length} past predictions`;
  
  if (history.length === 0) {
    container.innerHTML = '<p class="text-xs text-gray-500 italic">No prediction history yet</p>';
    return;
  }
  
  container.innerHTML = history.slice(-10).reverse().map(h => {
    const date = new Date(h.date).toLocaleDateString();
    const correctIcon = h.directionCorrect ? '✅' : '❌';
    return `
      <div class="flex items-center justify-between text-xs p-2 bg-white dark:bg-gray-800 rounded">
        <span class="text-gray-600 dark:text-gray-400">${date}</span>
        <span>${correctIcon} ${h.predictedDirection}</span>
        <span class="${h.accuracy >= 60 ? 'text-green-600' : 'text-red-600'}">${h.accuracy.toFixed(0)}%</span>
      </div>
    `;
  }).join('');
}

// ========== AI MARKET NEWSCAST FEATURE ==========
let newscastAudio = null;
let newscastText = '';
let newscastPodcastSegments = null;
let newscastIsPodcast = false;
let newscastIsPlaying = false;
let newscastAudioUrl = null;
let newscastShareUrl = null;

function saveNewscastToStorage() {
  try {
    localStorage.setItem('newscastData', JSON.stringify({
      text: newscastText,
      audioUrl: newscastAudioUrl,
      presenter: selectedPresenter,
      isPodcast: newscastIsPodcast,
      podcastSegments: newscastPodcastSegments,
      timestamp: Date.now()
    }));
  } catch (e) {
    console.warn('Failed to save newscast:', e);
  }
}

// Podcast history storage
let newscastHistory = [];

function saveNewscastHistory(entry) {
  try {
    const saved = localStorage.getItem('newscastHistory');
    newscastHistory = saved ? JSON.parse(saved) : [];
    
    // Get custom media URLs from selects
    const mediaUrls = getSelectedMediaUrls();
    
    // Get speaker video selections for each presenter
    const speakerVideos = {
      caelix: document.getElementById('speakerVideoCaelix')?.value || null,
      sophie: document.getElementById('speakerVideoSophie')?.value || null,
      jack: document.getElementById('speakerVideoJack')?.value || null,
      bateman: document.getElementById('speakerVideoBateman')?.value || null,
      mcafee: document.getElementById('speakerVideoMcafee')?.value || null
    };
    
    // Add new entry at the beginning (store all info needed for video regeneration)
    newscastHistory.unshift({
      id: Date.now(),
      text: entry.text,
      presenter: entry.presenter,
      guest: entry.guest || null,
      isPodcast: entry.isPodcast || false,
      podcastSegments: entry.podcastSegments || null,
      audioUrl: entry.audioUrl,
      videoUrl: entry.videoUrl || null,
      thumbnailUrl: entry.thumbnailUrl || null,
      createdAt: new Date().toISOString(),
      duration: entry.duration || null,
      customAvatarUrl: mediaUrls.customAvatarUrl,
      customBgVideoUrl: mediaUrls.customBgVideoUrl,
      customBgMusicUrl: mediaUrls.customBgMusicUrl,
      speakerVideos: speakerVideos
    });
    
    // Keep only last 20 entries
    newscastHistory = newscastHistory.slice(0, 20);
    localStorage.setItem('newscastHistory', JSON.stringify(newscastHistory));
    
    renderNewscastHistory();
  } catch (e) {
    console.warn('Failed to save newscast history:', e);
  }
}

function loadNewscastHistory() {
  try {
    const saved = localStorage.getItem('newscastHistory');
    newscastHistory = saved ? JSON.parse(saved) : [];
    renderNewscastHistory();
  } catch (e) {
    console.warn('Failed to load newscast history:', e);
    newscastHistory = [];
  }
}

function renderNewscastHistory() {
  const container = document.getElementById('newscastHistoryList');
  const countEl = document.getElementById('newscastHistoryCount');
  
  if (countEl) countEl.textContent = `${newscastHistory.length} broadcast${newscastHistory.length !== 1 ? 's' : ''}`;
  
  if (!container) return;
  
  if (newscastHistory.length === 0) {
    container.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400 text-center py-4">No broadcasts yet. Generate your first newscast above!</p>';
    return;
  }
  
  container.innerHTML = newscastHistory.map((item, idx) => {
    const date = new Date(item.createdAt);
    const dateStr = date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const presenterNameMap = {
      caelix: 'Caelix-9',
      sophie: 'Sophie',
      jack: 'Jack',
      bateman: 'Bateman',
      mcafee: 'McAfee'
    };
    let presenterName = presenterNameMap[item.presenter] || 'Unknown';
    // Show both hosts for podcasts
    if (item.isPodcast && item.guest && presenterNameMap[item.guest]) {
      presenterName = `${presenterNameMap[item.presenter]} & ${presenterNameMap[item.guest]}`;
    }
    const presenterImgMap = {
      caelix: '/images/presenter-caelix.png',
      sophie: '/images/presenter-sophie.png',
      jack: '/images/presenter-jack.png',
      bateman: '/downloads/media/avatar/patrick-bateman.png',
      mcafee: '/downloads/media/avatar/john-mcafee.png'
    };
    const presenterImg = presenterImgMap[item.presenter] || '/images/presenter-caelix.png';
    
    // Icon based on type
    const typeIcon = item.videoUrl 
      ? '<svg class="w-5 h-5 text-purple-500" fill="currentColor" viewBox="0 0 24 24"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>'
      : '<svg class="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
    
    const typeLabel = item.isPodcast ? 'Podcast' : 'Broadcast';
    
    return `
      <div class="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow" data-history-idx="${idx}">
        <div class="relative flex-shrink-0">
          <img src="${presenterImg}" alt="${presenterName}" class="w-12 h-12 rounded-full object-cover border-2 border-gray-200 dark:border-gray-600" onerror="this.src='/images/presenter-caelix.png'">
          <div class="absolute -bottom-1 -right-1 bg-white dark:bg-gray-700 rounded-full p-0.5">${typeIcon}</div>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-white truncate">${typeLabel} - ${presenterName}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">${dateStr}</p>
          <p class="text-xs text-gray-600 dark:text-gray-400 truncate mt-0.5">${(item.text || '').substring(0, 60)}...</p>
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">
          ${(item.audioUrl || item.videoUrl) ? `<button onclick="playHistoryItem(${idx})" class="p-2 text-gray-500 hover:text-blue-600 dark:hover:text-blue-400" title="Play"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>` : ''}
          ${item.audioUrl ? `<a href="${item.audioUrl}" download class="p-2 text-gray-500 hover:text-green-600 dark:hover:text-green-400" title="Download MP3"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg></a>` : ''}
          ${item.videoUrl ? `<a href="${item.videoUrl}" download class="p-2 text-gray-500 hover:text-purple-600 dark:hover:text-purple-400" title="Download MP4"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg></a>` : ''}
          ${item.videoUrl && item.audioUrl ? `<button onclick="generateVideoForHistoryItem(${idx}, true)" class="p-2 text-gray-500 hover:text-yellow-600 dark:hover:text-yellow-400" title="Regenerate Video"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg></button>` : ''}
          ${!item.videoUrl && item.audioUrl ? `<button onclick="generateVideoForHistoryItem(${idx})" class="p-2 text-gray-500 hover:text-purple-600 dark:hover:text-purple-400" title="Generate Video"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg></button>` : ''}
          <button onclick="shareHistoryItem(${idx})" class="p-2 text-gray-500 hover:text-orange-600 dark:hover:text-orange-400" title="Share"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg></button>
          <button onclick="deleteHistoryItem(${idx})" class="p-2 text-gray-500 hover:text-red-600 dark:hover:text-red-400" title="Delete"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
        </div>
      </div>
    `;
  }).join('');
}

// Global functions for history actions
window.playHistoryItem = function(idx) {
  const item = newscastHistory[idx];
  if (!item?.audioUrl && !item?.videoUrl) return;
  
  // Stop current audio if playing
  if (newscastAudio && newscastIsPlaying) {
    newscastAudio.pause();
    newscastIsPlaying = false;
  }
  
  // Open video player popup - prioritizes video if available
  openVideoPlayerPopup(item);
};

window.shareHistoryItem = function(idx) {
  const item = newscastHistory[idx];
  if (!item) return;
  
  // Extract broadcast ID from audio URL to generate proper share link
  // Match both broadcast-XXX and podcast-XXX patterns
  const audioId = item.audioUrl?.match(/(broadcast|podcast)-\d+/)?.[0];
  if (!audioId) {
    alert('Could not generate share link for this broadcast');
    return;
  }
  
  const presenterNames = { caelix: 'Magos Caelix-9', sophie: 'Sophie Mitchell', jack: 'Jack Thompson', bateman: 'Patrick Bateman', mcafee: 'John McAfee' };
  const presenterName = presenterNames[item.presenter] || presenterNames.caelix;
  const shareUrl = `${window.location.origin}/share/${audioId}`;
  const shareText = `Listen to ${presenterName}'s market update!`;
  
  // Show share modal with social options and download links
  showShareModal(shareUrl, shareText, presenterName, item.videoUrl, item.audioUrl);
};

// Share modal for social media options - stores data for button handlers
let currentShareData = null;

function showShareModal(shareUrl, shareText, presenterName, videoUrl = null, audioUrl = null) {
  // Store share data globally for button handlers
  currentShareData = { shareUrl, shareText, videoUrl, audioUrl };
  
  // Remove existing modal if present
  const existingModal = document.getElementById('shareModal');
  if (existingModal) existingModal.remove();
  
  // Build download buttons HTML
  let downloadButtons = '';
  if (videoUrl) {
    downloadButtons += `
      <button onclick="downloadShareVideo()" class="w-full flex items-center gap-3 p-3 bg-purple-700 hover:bg-purple-600 rounded-lg transition-colors">
        <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>
        <span class="text-white font-medium">Download Video (MP4)</span>
      </button>
    `;
  }
  if (audioUrl) {
    downloadButtons += `
      <button onclick="downloadShareAudio()" class="w-full flex items-center gap-3 p-3 bg-green-700 hover:bg-green-600 rounded-lg transition-colors">
        <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
        <span class="text-white font-medium">Download Audio (MP3)</span>
      </button>
    `;
  }
  
  // Build direct link buttons
  let directLinks = '';
  if (videoUrl) {
    directLinks += `
      <button onclick="copyVideoLink()" class="w-full flex items-center gap-3 p-3 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors">
        <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>
        <span class="text-white font-medium">Copy Video Link (MP4)</span>
      </button>
    `;
  }
  if (audioUrl) {
    directLinks += `
      <button onclick="copyAudioLink()" class="w-full flex items-center gap-3 p-3 bg-green-600 hover:bg-green-700 rounded-lg transition-colors">
        <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
        <span class="text-white font-medium">Copy Audio Link (MP3)</span>
      </button>
    `;
  }
  
  const modal = document.createElement('div');
  modal.id = 'shareModal';
  modal.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/70';
  modal.innerHTML = `
    <div class="bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl border border-gray-700 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-white">Share Broadcast</h3>
        <button onclick="document.getElementById('shareModal').remove()" class="text-gray-400 hover:text-white">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      
      <p class="text-gray-300 text-sm font-medium mb-2">Social Media (Rich Preview)</p>
      <div class="space-y-2 mb-4">
        <button onclick="doShareToTwitter()" class="w-full flex items-center gap-3 p-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
          <span class="text-xl">𝕏</span>
          <span class="text-white font-medium">Share on X (Twitter)</span>
        </button>
        <button onclick="doShareToDiscord()" class="w-full flex items-center gap-3 p-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
          <span class="text-xl">💬</span>
          <span class="text-white font-medium">Copy for Discord</span>
        </button>
      </div>
      
      <p class="text-gray-300 text-sm font-medium mb-2">Direct File Links</p>
      <div class="space-y-2 mb-4">
        ${directLinks}
      </div>
      
      <p class="text-gray-300 text-sm font-medium mb-2">Downloads</p>
      <div class="space-y-2">
        ${downloadButtons || '<p class="text-gray-500 text-sm">No files available</p>'}
      </div>
    </div>
  `;
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);
}

window.doShareToTwitter = function() {
  if (!currentShareData) return;
  const { shareUrl, shareText } = currentShareData;
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, '_blank', 'width=600,height=400');
  document.getElementById('shareModal')?.remove();
};

window.doShareToDiscord = async function() {
  if (!currentShareData) return;
  const { shareUrl } = currentShareData;
  try {
    await navigator.clipboard.writeText(shareUrl);
    alert('Link copied! Paste in Discord for a rich embed with presenter image.');
  } catch (e) {
    prompt('Copy this link and paste in Discord:', shareUrl);
  }
  document.getElementById('shareModal')?.remove();
};

window.doCopyShareLink = async function() {
  if (!currentShareData) return;
  const { shareUrl } = currentShareData;
  try {
    await navigator.clipboard.writeText(shareUrl);
    alert('Share link copied to clipboard!');
  } catch (e) {
    prompt('Copy this share link:', shareUrl);
  }
  document.getElementById('shareModal')?.remove();
};

window.downloadShareVideo = function() {
  if (!currentShareData?.videoUrl) return;
  const a = document.createElement('a');
  a.href = currentShareData.videoUrl;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  document.getElementById('shareModal')?.remove();
};

window.downloadShareAudio = function() {
  if (!currentShareData?.audioUrl) return;
  const a = document.createElement('a');
  a.href = currentShareData.audioUrl;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  document.getElementById('shareModal')?.remove();
};

window.copyVideoLink = async function() {
  if (!currentShareData?.shareUrl) return;
  // Use the share page URL which has video meta tags for rich previews
  try {
    await navigator.clipboard.writeText(currentShareData.shareUrl);
    alert('Video share link copied! This link shows rich preview with video on Discord & X.');
  } catch (e) {
    prompt('Copy this video share link:', currentShareData.shareUrl);
  }
  document.getElementById('shareModal')?.remove();
};

window.copyAudioLink = async function() {
  if (!currentShareData?.shareUrl) return;
  // Use the share page URL which has audio meta tags for rich previews
  try {
    await navigator.clipboard.writeText(currentShareData.shareUrl);
    alert('Audio share link copied! This link shows rich preview on Discord & X.');
  } catch (e) {
    prompt('Copy this audio share link:', currentShareData.shareUrl);
  }
  document.getElementById('shareModal')?.remove();
};

// Keep old functions for backward compatibility
window.shareToTwitter = window.doShareToTwitter;
window.shareToDiscord = window.doShareToDiscord;
window.copyShareLink = window.doCopyShareLink;

window.deleteHistoryItem = function(idx) {
  if (!confirm('Delete this broadcast?')) return;
  newscastHistory.splice(idx, 1);
  localStorage.setItem('newscastHistory', JSON.stringify(newscastHistory));
  renderNewscastHistory();
};

window.generateVideoForHistoryItem = async function(idx, overwrite = false) {
  const item = newscastHistory[idx];
  if (!item?.audioUrl) return;
  
  const statusDiv = document.getElementById('newscastVideoStatus');
  const statusText = document.getElementById('newscastVideoStatusText');
  
  if (statusDiv) statusDiv.classList.remove('hidden');
  if (statusText) statusText.textContent = overwrite ? 'Regenerating video with current settings...' : 'Generating video (this may take a minute)...';
  
  try {
    // ALWAYS use CURRENT UI media settings for generate/regenerate
    // This allows user to customize video with different media after recording
    const currentMediaUrls = getSelectedMediaUrls();
    const bgMusicVolume = parseInt(document.getElementById('bgMusicVolume')?.value || '15', 10) / 100;
    
    console.log('Generating video with segments:', item.podcastSegments?.length, 
                'has timing:', item.podcastSegments?.[0]?.duration !== undefined);
    
    const response = await fetch('/api/newscast/generate-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioUrl: item.audioUrl,
        presenter: item.presenter,
        guest: item.guest || null,
        isPodcast: item.isPodcast || false,
        podcastSegments: item.podcastSegments,
        showTitle: 'MARKET RADIO',
        overwrite: overwrite,
        bgMusicVolume,
        ...currentMediaUrls
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate video');
    }
    
    const data = await response.json();
    
    // Update history item with video URL
    newscastHistory[idx].videoUrl = data.videoUrl;
    newscastHistory[idx].thumbnailUrl = data.thumbnailUrl;
    localStorage.setItem('newscastHistory', JSON.stringify(newscastHistory));
    renderNewscastHistory();
    
    if (statusText) statusText.textContent = 'Video ready!';
    
    setTimeout(() => {
      if (statusDiv) statusDiv.classList.add('hidden');
    }, 3000);
    
  } catch (e) {
    console.error('Video generation error:', e);
    if (statusText) statusText.textContent = `Error: ${e.message}`;
    setTimeout(() => {
      if (statusDiv) statusDiv.classList.add('hidden');
    }, 5000);
  }
};

async function loadNewscastFromStorage() {
  try {
    const saved = localStorage.getItem('newscastData');
    if (saved) {
      const data = JSON.parse(saved);
      if (Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
        newscastText = data.text || '';
        newscastAudioUrl = data.audioUrl || null;
        newscastIsPodcast = data.isPodcast || false;
        newscastPodcastSegments = data.podcastSegments || null;
        if (data.presenter) selectedPresenter = data.presenter;
        
        const transcriptEl = document.getElementById('newscastTranscript');
        if (transcriptEl && newscastText) {
          // Use proper formatting for podcasts
          if (newscastIsPodcast && newscastPodcastSegments && newscastPodcastSegments.length > 0) {
            const formattedTranscript = newscastPodcastSegments.map(seg => 
              `<div class="mb-2"><span class="font-bold text-purple-600 dark:text-purple-400">${seg.speakerName}:</span> <span class="text-gray-700 dark:text-gray-300">${seg.text}</span></div>`
            ).join('');
            transcriptEl.innerHTML = `<div class="text-sm">${formattedTranscript}</div>`;
          } else {
            // Regular broadcast - use whitespace-pre-wrap for line breaks
            transcriptEl.innerHTML = `<p class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">${newscastText}</p>`;
          }
        }
        
        const presenterSelect = document.getElementById('newscastPresenterSelect');
        if (presenterSelect && data.presenter) {
          presenterSelect.value = data.presenter;
        }
        
        const presenterImage = document.getElementById('newscastPresenterImage');
        if (presenterImage && data.presenter) {
          const presenterConfig = {
            caelix: { src: '/images/presenter-caelix.png', alt: 'Magos Caelix-9', class: 'w-12 h-12 rounded-full object-cover border-2 border-red-600 shadow-lg shadow-red-500/30' },
            sophie: { src: '/images/presenter-sophie.png', alt: 'Sophie Mitchell', class: 'w-12 h-12 rounded-full object-cover border-2 border-pink-400 shadow-lg' },
            jack: { src: '/images/presenter-jack.png', alt: 'Jack Thompson', class: 'w-12 h-12 rounded-full object-cover border-2 border-blue-400 shadow-lg' },
            bateman: { src: '/downloads/media/avatar/patrick-bateman.png', alt: 'Patrick Bateman', class: 'w-12 h-12 rounded-full object-cover border-2 border-gray-600 shadow-lg' },
            mcafee: { src: '/downloads/media/avatar/john-mcafee.png', alt: 'John McAfee', class: 'w-12 h-12 rounded-full object-cover border-2 border-green-500 shadow-lg shadow-green-500/30' }
          };
          const config = presenterConfig[data.presenter] || presenterConfig.caelix;
          presenterImage.src = config.src;
          presenterImage.alt = config.alt;
          presenterImage.className = config.class;
        }
        
        if (newscastAudioUrl) {
          try {
            const audioResponse = await fetch(newscastAudioUrl, { method: 'HEAD' });
            if (audioResponse.ok) {
              newscastAudio = new Audio(newscastAudioUrl);
              newscastAudio.addEventListener('loadedmetadata', () => {
                const progressContainer = document.getElementById('newscastAudioProgress');
                progressContainer?.classList.remove('hidden');
                updateNewscastDuration();
              });
              newscastAudio.addEventListener('timeupdate', updateNewscastProgress);
              newscastAudio.addEventListener('ended', () => {
                newscastIsPlaying = false;
                document.getElementById('newscastPlayIcon')?.classList.remove('hidden');
                document.getElementById('newscastPauseIcon')?.classList.add('hidden');
                document.getElementById('newscastStatus').textContent = 'Finished';
              });
              const statusEl = document.getElementById('newscastStatus');
              if (statusEl) statusEl.textContent = 'Ready to play';
              console.log('Loaded saved audio from server');
            } else {
              newscastAudioUrl = null;
              console.log('Saved audio no longer available on server');
            }
          } catch (audioErr) {
            newscastAudioUrl = null;
            console.log('Could not load saved audio:', audioErr.message);
          }
        }
        
        console.log('Loaded saved newscast from storage');
      }
    }
  } catch (e) {
    console.warn('Failed to load newscast:', e);
  }
}

function setupNewscastHandlers() {
  loadNewscastFromStorage();
  loadNewscastHistory();
  
  const generateBtn = document.getElementById('newscastGenerateBtn');
  const playBtn = document.getElementById('newscastPlayBtn');
  const shareBtn = document.getElementById('newscastShareBtn');
  const presenterSelect = document.getElementById('newscastPresenterSelect');
  const presenterIcon = document.getElementById('newscastPresenterIcon');
  
  if (generateBtn) {
    generateBtn.addEventListener('click', generateNewscast);
  }
  
  if (playBtn) {
    playBtn.addEventListener('click', toggleNewscastPlayback);
  }
  
  if (shareBtn) {
    shareBtn.addEventListener('click', toggleSharePanel);
  }
  
  const presenterImage = document.getElementById('newscastPresenterImage');
  
  if (presenterSelect) {
    presenterSelect.addEventListener('change', () => {
      const val = presenterSelect.value;
      selectedPresenter = val;
      if (presenterImage) {
        const presenterConfig = {
          caelix: { src: '/images/presenter-caelix.png', alt: 'Magos Caelix-9', class: 'w-12 h-12 rounded-full object-cover border-2 border-red-600 shadow-lg shadow-red-500/30' },
          sophie: { src: '/images/presenter-sophie.png', alt: 'Sophie Mitchell', class: 'w-12 h-12 rounded-full object-cover border-2 border-pink-400 shadow-lg' },
          jack: { src: '/images/presenter-jack.png', alt: 'Jack Thompson', class: 'w-12 h-12 rounded-full object-cover border-2 border-blue-400 shadow-lg' },
          bateman: { src: '/downloads/media/avatar/patrick-bateman.png', alt: 'Patrick Bateman', class: 'w-12 h-12 rounded-full object-cover border-2 border-gray-600 shadow-lg' },
          mcafee: { src: '/downloads/media/avatar/john-mcafee.png', alt: 'John McAfee', class: 'w-12 h-12 rounded-full object-cover border-2 border-green-500 shadow-lg shadow-green-500/30' }
        };
        const config = presenterConfig[val] || presenterConfig.caelix;
        presenterImage.src = config.src;
        presenterImage.alt = config.alt;
        presenterImage.className = config.class;
      }
      newscastAudio = null;
    });
  }
  
  // Daily Podcast checkbox - enable/disable guest participation and topic input
  const dailyPodcastCheck = document.getElementById('newscastDailyPodcastCheck');
  const guestCheck = document.getElementById('newscastGuestCheck');
  const guestLabel = document.getElementById('guestParticipationLabel');
  const podcastTopicContainer = document.getElementById('podcastTopicContainer');
  
  if (dailyPodcastCheck && guestCheck && guestLabel) {
    dailyPodcastCheck.addEventListener('change', () => {
      if (dailyPodcastCheck.checked) {
        guestCheck.disabled = false;
        guestCheck.checked = true;
        guestLabel.classList.remove('opacity-50');
        if (podcastTopicContainer) podcastTopicContainer.classList.remove('hidden');
      } else {
        guestCheck.disabled = true;
        guestCheck.checked = false;
        guestLabel.classList.add('opacity-50');
        if (podcastTopicContainer) podcastTopicContainer.classList.add('hidden');
      }
    });
  }
  
  document.getElementById('shareTwitterBtn')?.addEventListener('click', () => shareToSocial('twitter'));
  document.getElementById('shareFacebookBtn')?.addEventListener('click', () => shareToSocial('facebook'));
  document.getElementById('shareLinkedInBtn')?.addEventListener('click', () => shareToSocial('linkedin'));
  document.getElementById('shareCopyBtn')?.addEventListener('click', copyNewscastToClipboard);
  
  // Media customization toggle
  document.getElementById('toggleMediaCustomization')?.addEventListener('click', () => {
    const panel = document.getElementById('mediaCustomizationPanel');
    const btn = document.getElementById('toggleMediaCustomization');
    if (panel && btn) {
      panel.classList.toggle('hidden');
      btn.textContent = panel.classList.contains('hidden') ? 'Show' : 'Hide';
      if (!panel.classList.contains('hidden')) {
        loadMediaFiles(); // Refresh file list when panel opens
      }
    }
  });
  
  // Media file upload handlers
  setupMediaUploadHandlers();
  
  // Video player popup handlers
  setupVideoPlayerPopup();
  
  document.getElementById('newscastSkipBack')?.addEventListener('click', () => {
    if (newscastAudio) {
      newscastAudio.currentTime = Math.max(0, newscastAudio.currentTime - 10);
    }
  });
  
  document.getElementById('newscastSkipForward')?.addEventListener('click', () => {
    if (newscastAudio) {
      newscastAudio.currentTime = Math.min(newscastAudio.duration, newscastAudio.currentTime + 10);
    }
  });
  
  document.getElementById('newscastDownload')?.addEventListener('click', () => {
    if (newscastAudioUrl) {
      const a = document.createElement('a');
      a.href = newscastAudioUrl;
      a.download = `market-radio-${new Date().toISOString().split('T')[0]}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      alert('Play the broadcast first to generate the audio file');
    }
  });
  
  document.getElementById('newscastGenerateVideo')?.addEventListener('click', generateNewscastVideo);
  
  // Quick video button (next to play button)
  document.getElementById('newscastQuickVideoBtn')?.addEventListener('click', generateNewscastVideo);
  
  // Copy script to editor button
  document.getElementById('copyScriptToEditorBtn')?.addEventListener('click', () => {
    const editor = document.getElementById('newscastScriptEditor');
    if (editor && newscastText) {
      editor.value = newscastText;
    }
  });
  
  // Generate audio from custom text
  document.getElementById('generateAudioFromTextBtn')?.addEventListener('click', generateAudioFromText);
  
  document.getElementById('newscastProgressTrack')?.addEventListener('click', (e) => {
    if (newscastAudio && newscastAudio.duration) {
      const rect = e.currentTarget.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      newscastAudio.currentTime = percent * newscastAudio.duration;
    }
  });
}

// Generate audio from custom text
async function generateAudioFromText() {
  const editor = document.getElementById('newscastScriptEditor');
  const statusEl = document.getElementById('audioFromTextStatus');
  const btn = document.getElementById('generateAudioFromTextBtn');
  const presenterSelect = document.getElementById('newscastPresenterSelect');
  const transcriptEl = document.getElementById('newscastTranscript');
  
  const text = editor?.value?.trim();
  if (!text) {
    alert('Please enter or paste some text in the script editor');
    return;
  }
  
  const presenter = presenterSelect?.value || 'caelix';
  
  if (btn) btn.disabled = true;
  if (statusEl) {
    statusEl.textContent = 'Generating audio...';
    statusEl.classList.remove('hidden');
  }
  
  try {
    const response = await fetch('/api/newscast/tts-from-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, presenter })
    });
    
    if (!response.ok) throw new Error('Failed to generate audio');
    
    const data = await response.json();
    
    // Update the newscast state
    newscastText = data.text;
    newscastAudioUrl = data.audioUrl;
    newscastIsPodcast = false;
    newscastPodcastSegments = null;
    
    // Update transcript display
    if (transcriptEl) {
      transcriptEl.innerHTML = `<p class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">${newscastText}</p>`;
    }
    
    // Reset audio player
    newscastAudio = null;
    
    // Update status
    document.getElementById('newscastStatus').textContent = 'Audio ready';
    if (statusEl) statusEl.textContent = 'Audio generated!';
    
    // Save to storage
    saveNewscastToStorage();
    
    // Add to history (matches format used by regular broadcasts)
    const historyItem = {
      id: `custom-${Date.now()}`,
      createdAt: new Date().toISOString(),
      presenter: presenter,
      text: newscastText,
      audioUrl: newscastAudioUrl,
      isPodcast: false,
      isCustomText: true
    };
    newscastHistory.unshift(historyItem);
    if (newscastHistory.length > 50) newscastHistory.pop();
    saveNewscastHistory();
    renderNewscastHistory();
    
    setTimeout(() => {
      if (statusEl) statusEl.classList.add('hidden');
    }, 3000);
    
  } catch (error) {
    console.error('Generate audio from text error:', error);
    if (statusEl) {
      statusEl.textContent = 'Error generating audio';
      statusEl.classList.remove('hidden');
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Generate video from current podcast/broadcast
async function generateNewscastVideo() {
  if (!newscastAudioUrl) {
    alert('Generate and play a broadcast first before creating a video');
    return;
  }
  
  const videoBtn = document.getElementById('newscastGenerateVideo');
  const statusDiv = document.getElementById('newscastVideoStatus');
  const statusText = document.getElementById('newscastVideoStatusText');
  
  if (videoBtn) videoBtn.disabled = true;
  if (statusDiv) statusDiv.classList.remove('hidden');
  if (statusText) statusText.textContent = 'Generating video (this may take a minute)...';
  
  try {
    const mediaUrls = getSelectedMediaUrls();
    const bgMusicVolume = parseInt(document.getElementById('bgMusicVolume')?.value || '15', 10) / 100;
    const response = await fetch('/api/newscast/generate-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioUrl: newscastAudioUrl,
        podcastSegments: newscastPodcastSegments,
        presenter: selectedPresenter,
        bgMusicVolume,
        ...mediaUrls
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate video');
    }
    
    const data = await response.json();
    
    if (statusText) statusText.textContent = 'Video ready! Downloading...';
    
    // Update history with video URL
    if (newscastHistory.length > 0) {
      newscastHistory[0].videoUrl = data.videoUrl;
      newscastHistory[0].thumbnailUrl = data.thumbnailUrl;
      localStorage.setItem('newscastHistory', JSON.stringify(newscastHistory));
      renderNewscastHistory();
    }
    
    // Trigger download
    const a = document.createElement('a');
    a.href = data.videoUrl;
    a.download = `market-radio-${new Date().toISOString().split('T')[0]}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    setTimeout(() => {
      if (statusDiv) statusDiv.classList.add('hidden');
    }, 3000);
    
  } catch (e) {
    console.error('Video generation error:', e);
    if (statusText) statusText.textContent = `Error: ${e.message}`;
    setTimeout(() => {
      if (statusDiv) statusDiv.classList.add('hidden');
    }, 5000);
  } finally {
    if (videoBtn) videoBtn.disabled = false;
  }
}

// Media upload and file management
let availableMediaFiles = { avatar: [], video: [], music: [] };

function setupMediaUploadHandlers() {
  // Avatar upload
  document.getElementById('avatarFileInput')?.addEventListener('change', async (e) => {
    if (e.target.files?.length) {
      await uploadMediaFile(e.target.files[0], 'avatar', 'avatarUploadStatus');
      e.target.value = '';
    }
  });
  
  // Video upload
  document.getElementById('videoFileInput')?.addEventListener('change', async (e) => {
    if (e.target.files?.length) {
      await uploadMediaFile(e.target.files[0], 'video', 'videoUploadStatus');
      e.target.value = '';
    }
  });
  
  // Music upload
  document.getElementById('musicFileInput')?.addEventListener('change', async (e) => {
    if (e.target.files?.length) {
      await uploadMediaFile(e.target.files[0], 'music', 'musicUploadStatus');
      e.target.value = '';
    }
  });
  
  // Save selections when user changes dropdowns
  const selectIds = ['customAvatarSelect', 'customBgVideoSelect', 'customBgMusicSelect', 
                     'speakerVideoCaelix', 'speakerVideoSophie', 'speakerVideoJack', 'speakerVideoBateman', 'speakerVideoMcafee'];
  selectIds.forEach(id => {
    document.getElementById(id)?.addEventListener('change', saveMediaSelections);
  });
  
  // Volume slider updates label and saves
  const volumeSlider = document.getElementById('bgMusicVolume');
  const volumeLabel = document.getElementById('bgMusicVolumeLabel');
  volumeSlider?.addEventListener('input', () => {
    if (volumeLabel) volumeLabel.textContent = `${volumeSlider.value}%`;
    saveMediaSelections();
  });
  
  // Script length slider updates label
  const scriptLengthSlider = document.getElementById('scriptLengthSlider');
  const scriptLengthLabel = document.getElementById('scriptLengthLabel');
  scriptLengthSlider?.addEventListener('input', () => {
    const val = parseInt(scriptLengthSlider.value);
    const minWords = val - 50;
    const maxWords = val + 50;
    if (scriptLengthLabel) scriptLengthLabel.textContent = `${minWords}-${maxWords} words`;
  });
}

async function uploadMediaFile(file, type, statusId) {
  const statusEl = document.getElementById(statusId);
  if (statusEl) {
    statusEl.textContent = `Uploading ${file.name}...`;
    statusEl.classList.remove('hidden');
  }
  
  try {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch(`/api/media/upload/${type}`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Upload failed');
    }
    
    const data = await response.json();
    if (statusEl) {
      statusEl.textContent = `Uploaded: ${data.filename}`;
      setTimeout(() => statusEl.classList.add('hidden'), 3000);
    }
    
    // Refresh file list and select the new file
    await loadMediaFiles();
    const selectId = type === 'avatar' ? 'customAvatarSelect' : 
                     type === 'video' ? 'customBgVideoSelect' : 'customBgMusicSelect';
    const select = document.getElementById(selectId);
    if (select) select.value = data.url;
    
  } catch (e) {
    console.error('Upload error:', e);
    if (statusEl) {
      statusEl.textContent = `Error: ${e.message}`;
      statusEl.classList.remove('hidden');
    }
  }
}

async function loadMediaFiles() {
  try {
    const response = await fetch('/api/media/list');
    if (response.ok) {
      availableMediaFiles = await response.json();
      populateMediaSelects();
      loadMediaSelections(); // Restore saved selections
    }
  } catch (e) {
    console.error('Failed to load media files:', e);
  }
}

function populateMediaSelects() {
  // Avatar select
  const avatarSelect = document.getElementById('customAvatarSelect');
  if (avatarSelect) {
    const currentValue = avatarSelect.value;
    avatarSelect.innerHTML = '<option value="">Default presenter image</option>';
    availableMediaFiles.avatar.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.url;
      opt.textContent = f.filename.substring(14); // Remove timestamp prefix
      avatarSelect.appendChild(opt);
    });
    if (currentValue) avatarSelect.value = currentValue;
  }
  
  // Video select
  const videoSelect = document.getElementById('customBgVideoSelect');
  if (videoSelect) {
    const currentValue = videoSelect.value;
    videoSelect.innerHTML = '<option value="">No background video</option>';
    availableMediaFiles.video.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.url;
      opt.textContent = f.filename.substring(14);
      videoSelect.appendChild(opt);
    });
    if (currentValue) videoSelect.value = currentValue;
  }
  
  // Music select
  const musicSelect = document.getElementById('customBgMusicSelect');
  if (musicSelect) {
    const currentValue = musicSelect.value;
    musicSelect.innerHTML = '<option value="">No background music</option>';
    availableMediaFiles.music.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.url;
      opt.textContent = f.filename.substring(14);
      musicSelect.appendChild(opt);
    });
    if (currentValue) musicSelect.value = currentValue;
  }
  
  // Per-speaker video selects
  const speakerSelects = ['speakerVideoCaelix', 'speakerVideoSophie', 'speakerVideoJack', 'speakerVideoBateman', 'speakerVideoMcafee'];
  speakerSelects.forEach(selectId => {
    const select = document.getElementById(selectId);
    if (select) {
      const currentValue = select.value;
      select.innerHTML = '<option value="">None</option>';
      availableMediaFiles.video.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.url;
        opt.textContent = f.filename.substring(14);
        select.appendChild(opt);
      });
      if (currentValue) select.value = currentValue;
    }
  });
}

// Get selected media URLs from dropdowns
function getSelectedMediaUrls() {
  return {
    customAvatarUrl: document.getElementById('customAvatarSelect')?.value || null,
    customBgVideoUrl: document.getElementById('customBgVideoSelect')?.value || null,
    customBgMusicUrl: document.getElementById('customBgMusicSelect')?.value || null,
    speakerVideos: {
      caelix: document.getElementById('speakerVideoCaelix')?.value || null,
      sophie: document.getElementById('speakerVideoSophie')?.value || null,
      jack: document.getElementById('speakerVideoJack')?.value || null,
      bateman: document.getElementById('speakerVideoBateman')?.value || null,
      mcafee: document.getElementById('speakerVideoMcafee')?.value || null
    }
  };
}

// Save media selections to localStorage
function saveMediaSelections() {
  // Get current saved values to avoid overwriting with empty
  let existing = {};
  try {
    existing = JSON.parse(localStorage.getItem('mediaSelections') || '{}');
  } catch (e) {}
  
  const selections = {
    avatar: document.getElementById('customAvatarSelect')?.value || existing.avatar || '',
    video: document.getElementById('customBgVideoSelect')?.value || existing.video || '',
    music: document.getElementById('customBgMusicSelect')?.value || existing.music || '',
    musicVolume: document.getElementById('bgMusicVolume')?.value || existing.musicVolume || '15',
    speakerVideoCaelix: document.getElementById('speakerVideoCaelix')?.value || existing.speakerVideoCaelix || '',
    speakerVideoSophie: document.getElementById('speakerVideoSophie')?.value || existing.speakerVideoSophie || '',
    speakerVideoJack: document.getElementById('speakerVideoJack')?.value || existing.speakerVideoJack || '',
    speakerVideoBateman: document.getElementById('speakerVideoBateman')?.value || existing.speakerVideoBateman || '',
    speakerVideoMcafee: document.getElementById('speakerVideoMcafee')?.value || existing.speakerVideoMcafee || ''
  };
  localStorage.setItem('mediaSelections', JSON.stringify(selections));
}

// Load saved media selections from localStorage
function loadMediaSelections() {
  try {
    const saved = localStorage.getItem('mediaSelections');
    if (!saved) return;
    const selections = JSON.parse(saved);
    
    const avatarSelect = document.getElementById('customAvatarSelect');
    const videoSelect = document.getElementById('customBgVideoSelect');
    const musicSelect = document.getElementById('customBgMusicSelect');
    const volumeSlider = document.getElementById('bgMusicVolume');
    const volumeLabel = document.getElementById('bgMusicVolumeLabel');
    const caelixSelect = document.getElementById('speakerVideoCaelix');
    const sophieSelect = document.getElementById('speakerVideoSophie');
    const jackSelect = document.getElementById('speakerVideoJack');
    const batemanSelect = document.getElementById('speakerVideoBateman');
    const mcafeeSelect = document.getElementById('speakerVideoMcafee');
    
    if (avatarSelect && selections.avatar) avatarSelect.value = selections.avatar;
    if (videoSelect && selections.video) videoSelect.value = selections.video;
    if (musicSelect && selections.music) musicSelect.value = selections.music;
    if (volumeSlider && selections.musicVolume) {
      volumeSlider.value = selections.musicVolume;
      if (volumeLabel) volumeLabel.textContent = `${selections.musicVolume}%`;
    }
    if (caelixSelect && selections.speakerVideoCaelix) caelixSelect.value = selections.speakerVideoCaelix;
    if (sophieSelect && selections.speakerVideoSophie) sophieSelect.value = selections.speakerVideoSophie;
    if (jackSelect && selections.speakerVideoJack) jackSelect.value = selections.speakerVideoJack;
    if (batemanSelect && selections.speakerVideoBateman) batemanSelect.value = selections.speakerVideoBateman;
    if (mcafeeSelect && selections.speakerVideoMcafee) mcafeeSelect.value = selections.speakerVideoMcafee;
  } catch (e) {
    console.error('Failed to load media selections:', e);
  }
}

function toggleSharePanel() {
  const panel = document.getElementById('newscastSharePanel');
  if (panel) {
    panel.classList.toggle('hidden');
  }
}

// Video Player Popup
let videoPlayerAudio = null;
let videoPlayerIsPlaying = false;
let currentVideoPlayerItem = null;

function setupVideoPlayerPopup() {
  const popup = document.getElementById('videoPlayerPopup');
  const closeBtn = document.getElementById('closeVideoPlayer');
  const playBtn = document.getElementById('videoPlayerPlayBtn');
  const progressTrack = document.getElementById('videoPlayerProgressTrack');
  
  closeBtn?.addEventListener('click', closeVideoPlayerPopup);
  popup?.addEventListener('click', (e) => {
    if (e.target === popup) closeVideoPlayerPopup();
  });
  
  playBtn?.addEventListener('click', toggleVideoPlayerPlayback);
  
  progressTrack?.addEventListener('click', (e) => {
    if (videoPlayerAudio && videoPlayerAudio.duration) {
      const rect = e.currentTarget.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      videoPlayerAudio.currentTime = percent * videoPlayerAudio.duration;
    }
  });
}

function openVideoPlayerPopup(item) {
  const popup = document.getElementById('videoPlayerPopup');
  if (!popup || !item) return;
  
  currentVideoPlayerItem = item;
  
  const presenterConfig = {
    caelix: { name: 'Magos Caelix-9', station: 'Forge World Markets', img: '/images/presenter-caelix.png', border: 'border-red-600' },
    sophie: { name: 'Sophie Mitchell', station: "Sophie's Market Corner", img: '/images/presenter-sophie.png', border: 'border-pink-400' },
    jack: { name: 'Jack Thompson', station: 'Sydney Markets Radio', img: '/images/presenter-jack.png', border: 'border-blue-400' },
    bateman: { name: 'Patrick Bateman', station: 'Morning Markets with Bateman', img: '/downloads/media/avatar/patrick-bateman.png', border: 'border-gray-600' },
    mcafee: { name: 'John McAfee', station: 'Crypto Jungle Radio', img: '/downloads/media/avatar/john-mcafee.png', border: 'border-green-500' }
  };
  
  const config = presenterConfig[item.presenter] || presenterConfig.caelix;
  const avatarUrl = item.customAvatarUrl || config.img;
  
  document.getElementById('videoPlayerAvatar').src = avatarUrl;
  document.getElementById('videoPlayerPresenterSmall').src = avatarUrl;
  document.getElementById('videoPlayerPresenterName').textContent = config.name;
  document.getElementById('videoPlayerStationName').textContent = config.station;
  
  const downloadMp3 = document.getElementById('videoPlayerDownloadMp3');
  const downloadMp4 = document.getElementById('videoPlayerDownloadMp4');
  const mainVideo = document.getElementById('videoPlayerMainVideo');
  const audioMode = document.getElementById('videoPlayerAudioMode');
  const controlsSection = document.querySelector('#videoPlayerPopup .p-4.bg-gray-800 > .flex:last-child');
  
  if (downloadMp3 && item.audioUrl) {
    downloadMp3.href = item.audioUrl;
    downloadMp3.classList.remove('hidden');
  }
  
  if (downloadMp4 && item.videoUrl) {
    downloadMp4.href = item.videoUrl;
    downloadMp4.classList.remove('hidden');
  } else if (downloadMp4) {
    downloadMp4.classList.add('hidden');
  }
  
  // Setup share button
  const shareBtn = document.getElementById('videoPlayerShareBtn');
  if (shareBtn) {
    shareBtn.onclick = () => shareVideoPlayer(item);
  }
  
  popup.classList.remove('hidden');
  popup.classList.add('flex');
  
  // If video exists, play the actual MP4 video
  if (item.videoUrl && mainVideo) {
    mainVideo.src = item.videoUrl;
    mainVideo.classList.remove('hidden');
    if (audioMode) audioMode.classList.add('hidden');
    // Keep controls visible for share/download buttons but hide audio-specific controls
    const playBtn = document.getElementById('videoPlayerPlayBtn');
    const progressTrack = document.getElementById('videoPlayerProgressTrack');
    const timeEl = document.getElementById('videoPlayerTime');
    if (playBtn) playBtn.classList.add('hidden');
    if (progressTrack) progressTrack.classList.add('hidden');
    if (timeEl) timeEl.classList.add('hidden');
    mainVideo.play();
    videoPlayerIsPlaying = true;
    
    mainVideo.addEventListener('ended', () => {
      videoPlayerIsPlaying = false;
    });
  } else {
    // Audio-only mode with presenter avatar
    if (mainVideo) {
      mainVideo.classList.add('hidden');
      mainVideo.src = '';
    }
    if (audioMode) audioMode.classList.remove('hidden');
    // Show audio controls
    const playBtn = document.getElementById('videoPlayerPlayBtn');
    const progressTrack = document.getElementById('videoPlayerProgressTrack');
    const timeEl = document.getElementById('videoPlayerTime');
    if (playBtn) playBtn.classList.remove('hidden');
    if (progressTrack) progressTrack.classList.remove('hidden');
    if (timeEl) timeEl.classList.remove('hidden');
    
    if (item.audioUrl) {
      if (videoPlayerAudio) {
        videoPlayerAudio.pause();
      }
      videoPlayerAudio = new Audio(item.audioUrl);
      videoPlayerAudio.play();
      videoPlayerIsPlaying = true;
      updateVideoPlayerPlayIcon(true);
      
      videoPlayerAudio.addEventListener('timeupdate', updateVideoPlayerProgress);
      videoPlayerAudio.addEventListener('ended', () => {
        videoPlayerIsPlaying = false;
        updateVideoPlayerPlayIcon(false);
      });
    }
  }
}

function closeVideoPlayerPopup() {
  const popup = document.getElementById('videoPlayerPopup');
  if (popup) {
    popup.classList.add('hidden');
    popup.classList.remove('flex');
  }
  
  if (videoPlayerAudio) {
    videoPlayerAudio.pause();
    videoPlayerAudio = null;
  }
  videoPlayerIsPlaying = false;
  
  const mainVideo = document.getElementById('videoPlayerMainVideo');
  if (mainVideo) {
    mainVideo.pause();
    mainVideo.src = '';
  }
}

function toggleVideoPlayerPlayback() {
  if (!videoPlayerAudio) return;
  
  if (videoPlayerIsPlaying) {
    videoPlayerAudio.pause();
    videoPlayerIsPlaying = false;
  } else {
    videoPlayerAudio.play();
    videoPlayerIsPlaying = true;
  }
  updateVideoPlayerPlayIcon(videoPlayerIsPlaying);
}

function updateVideoPlayerPlayIcon(isPlaying) {
  const icon = document.getElementById('videoPlayerPlayIcon');
  if (icon) {
    icon.innerHTML = isPlaying 
      ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
      : '<path d="M8 5v14l11-7z"/>';
  }
}

function updateVideoPlayerProgress() {
  if (!videoPlayerAudio) return;
  
  const progress = document.getElementById('videoPlayerProgress');
  const timeEl = document.getElementById('videoPlayerTime');
  
  const percent = (videoPlayerAudio.currentTime / videoPlayerAudio.duration) * 100;
  if (progress) progress.style.width = `${percent}%`;
  
  if (timeEl) {
    const formatTime = (s) => {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${m}:${sec.toString().padStart(2, '0')}`;
    };
    timeEl.textContent = `${formatTime(videoPlayerAudio.currentTime)} / ${formatTime(videoPlayerAudio.duration || 0)}`;
  }
}

async function shareVideoPlayer(item) {
  if (!item) return;
  
  const presenterNames = { caelix: 'Magos Caelix-9', sophie: 'Sophie Mitchell', jack: 'Jack Thompson', bateman: 'Patrick Bateman', mcafee: 'John McAfee' };
  const presenterName = presenterNames[item.presenter] || presenterNames.caelix;
  
  // Extract broadcast ID from audio URL (match both broadcast and podcast)
  const audioId = item.audioUrl?.match(/(broadcast|podcast)-\d+/)?.[0];
  if (!audioId) {
    alert('Could not generate share link');
    return;
  }
  
  const shareUrl = `${window.location.origin}/share/${audioId}`;
  const shareText = `Listen to ${presenterName}'s market update!`;
  
  // Use the same share modal as history items, include download links
  showShareModal(shareUrl, shareText, presenterName, item.videoUrl, item.audioUrl);
}

function shareToSocial(platform) {
  if (!newscastShareUrl && !newscastAudioUrl) {
    alert('Play the broadcast first to generate a shareable audio link!');
    return;
  }
  
  const presenterNames = { caelix: 'Magos Caelix-9', sophie: 'Sophie Mitchell', jack: 'Jack Thompson', bateman: 'Patrick Bateman', mcafee: 'John McAfee' };
  const stationNames = { caelix: 'Forge World Markets', sophie: "Sophie's Market Corner", jack: 'Sydney Markets Radio' };
  const presenterName = presenterNames[selectedPresenter] || presenterNames.caelix;
  const stationName = stationNames[selectedPresenter] || stationNames.caelix;
  const asset = document.getElementById('forecastAssetSelect')?.value || 'silver';
  const shareText = `Listen to ${presenterName}'s ${asset.toUpperCase()} market update on ${stationName}!`;
  // Use the share page URL for better social media previews
  const shareUrl = newscastShareUrl ? window.location.origin + newscastShareUrl : window.location.origin + newscastAudioUrl;
  
  let url = '';
  switch (platform) {
    case 'twitter':
      url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
      break;
    case 'facebook':
      url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(shareText)}`;
      break;
    case 'linkedin':
      url = `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(shareText)}`;
      break;
  }
  
  if (url) {
    window.open(url, '_blank', 'width=600,height=400');
  }
}

async function copyNewscastToClipboard() {
  if (!newscastShareUrl && !newscastAudioUrl) {
    alert('Play the broadcast first to generate a shareable audio link!');
    return;
  }
  
  try {
    // Use the share page URL for better previews
    const fullUrl = newscastShareUrl ? window.location.origin + newscastShareUrl : window.location.origin + newscastAudioUrl;
    await navigator.clipboard.writeText(fullUrl);
    const btn = document.getElementById('shareCopyBtn');
    if (btn) {
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg><span class="text-xs">Copied!</span>';
      setTimeout(() => { btn.innerHTML = originalHTML; }, 2000);
    }
  } catch (e) {
    alert('Failed to copy to clipboard');
  }
}

let selectedPresenter = 'caelix';

async function generateNewscast() {
  const generateBtn = document.getElementById('newscastGenerateBtn');
  const statusEl = document.getElementById('newscastStatus');
  const loadingEl = document.getElementById('newscastLoadingIndicator');
  const transcriptEl = document.getElementById('newscastTranscript');
  
  if (!generateBtn) return;
  
  try {
    generateBtn.disabled = true;
    statusEl.textContent = 'Generating...';
    loadingEl?.classList.remove('hidden');
    
    const asset = document.getElementById('forecastAssetSelect')?.value || 'silver';
    selectedPresenter = document.getElementById('newscastPresenterSelect')?.value || 'sophie';
    
    let currentPrice = forecastData.days?.[0]?.actual?.[0] || 0;
    if (!currentPrice || currentPrice === 0) {
      try {
        const priceRes = await fetch(`/api/market-data/${asset}/1m`);
        if (priceRes.ok) {
          const priceData = await priceRes.json();
          if (priceData.candles && priceData.candles.length > 0) {
            currentPrice = priceData.candles[priceData.candles.length - 1].close;
          }
        }
      } catch (e) { console.warn('Could not fetch current price:', e); }
    }
    
    let brainData = {};
    try {
      const brainRes = await fetch('/api/ai/brain');
      if (brainRes.ok) brainData = await brainRes.json();
    } catch (e) {}
    
    const marketForecastCheckbox = document.getElementById('newscastMarketForecastCheck');
    const sevenDayForecastCheckbox = document.getElementById('newscast7DayForecastCheck');
    const introAdCheckbox = document.getElementById('newscastIntroAdCheck');
    const outroAdCheckbox = document.getElementById('newscastOutroAdCheck');
    const worldNewsCheckbox = document.getElementById('newscastWorldNewsCheck');
    const dailyPodcastCheckbox = document.getElementById('newscastDailyPodcastCheck');
    const guestParticipationCheckbox = document.getElementById('newscastGuestCheck');
    const adTopicInput = document.getElementById('newscastAdTopic');
    const podcastTopicInput = document.getElementById('podcastTopicInput');
    const scriptLengthSlider = document.getElementById('scriptLengthSlider');
    const scriptLength = scriptLengthSlider ? parseInt(scriptLengthSlider.value) : 200;
    const includeMarketForecast = marketForecastCheckbox ? marketForecastCheckbox.checked : true;
    const include7DayForecast = sevenDayForecastCheckbox ? sevenDayForecastCheckbox.checked : false;
    const includeIntroAd = introAdCheckbox ? introAdCheckbox.checked : false;
    const includeOutroAd = outroAdCheckbox ? outroAdCheckbox.checked : false;
    const includeWorldNews = worldNewsCheckbox ? worldNewsCheckbox.checked : false;
    const isDailyPodcast = dailyPodcastCheckbox ? dailyPodcastCheckbox.checked : false;
    const includeGuest = guestParticipationCheckbox ? guestParticipationCheckbox.checked : false;
    const adTopic = adTopicInput ? adTopicInput.value.trim() : '';
    const podcastTopic = podcastTopicInput ? podcastTopicInput.value.trim() : '';
    
    const response = await fetch('/api/newscast/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        forecastData,
        asset,
        currentPrice,
        brainData,
        presenter: selectedPresenter,
        includeMarketForecast,
        include7DayForecast,
        includeIntroAd,
        includeOutroAd,
        includeWorldNews,
        isDailyPodcast,
        includeGuest,
        adTopic,
        podcastTopic,
        scriptLength
      })
    });
    
    if (!response.ok) throw new Error('Failed to generate newscast');
    
    const data = await response.json();
    newscastText = data.text;
    newscastIsPodcast = data.isPodcast || false;
    newscastPodcastSegments = data.podcastSegments || null;
    
    if (transcriptEl) {
      if (newscastIsPodcast && newscastPodcastSegments) {
        // Format podcast transcript with speaker labels
        const formattedTranscript = newscastPodcastSegments.map(seg => 
          `<div class="mb-2"><span class="font-bold text-purple-600 dark:text-purple-400">${seg.speakerName}:</span> <span class="text-gray-700 dark:text-gray-300">${seg.text}</span></div>`
        ).join('');
        transcriptEl.innerHTML = `<div class="text-sm">${formattedTranscript}</div>`;
      } else {
        transcriptEl.innerHTML = `<p class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">${newscastText}</p>`;
      }
    }
    
    statusEl.textContent = newscastIsPodcast ? 'Podcast ready to play' : 'Ready to play';
    
    newscastAudio = null;
    newscastAudioUrl = null;
    saveNewscastToStorage();
    
  } catch (e) {
    console.error('Newscast generation error:', e);
    statusEl.textContent = 'Error generating';
    if (transcriptEl) {
      transcriptEl.innerHTML = `<p class="text-sm text-red-500">Sorry, couldn't generate the newscast. Please try again.</p>`;
    }
  } finally {
    generateBtn.disabled = false;
    loadingEl?.classList.add('hidden');
  }
}

async function toggleNewscastPlayback() {
  const playBtn = document.getElementById('newscastPlayBtn');
  const playIcon = document.getElementById('newscastPlayIcon');
  const pauseIcon = document.getElementById('newscastPauseIcon');
  const statusEl = document.getElementById('newscastStatus');
  const progressContainer = document.getElementById('newscastAudioProgress');
  
  if (!newscastText) {
    statusEl.textContent = 'Generate first';
    return;
  }
  
  if (newscastIsPlaying && newscastAudio) {
    newscastAudio.pause();
    newscastIsPlaying = false;
    playIcon?.classList.remove('hidden');
    pauseIcon?.classList.add('hidden');
    statusEl.textContent = 'Paused';
    return;
  }
  
  if (newscastAudio && !newscastIsPlaying) {
    newscastAudio.play();
    newscastIsPlaying = true;
    playIcon?.classList.add('hidden');
    pauseIcon?.classList.remove('hidden');
    statusEl.textContent = 'Playing...';
    return;
  }
  
  try {
    playBtn.disabled = true;
    
    // Use appropriate TTS endpoint based on content type
    let response;
    if (newscastIsPodcast && newscastPodcastSegments && newscastPodcastSegments.length > 0) {
      statusEl.textContent = `Generating podcast audio (${newscastPodcastSegments.length} segments)...`;
      response = await fetch('/api/newscast/speak-podcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ podcastSegments: newscastPodcastSegments, presenter: selectedPresenter })
      });
    } else {
      statusEl.textContent = 'Loading audio...';
      response = await fetch('/api/newscast/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newscastText, presenter: selectedPresenter })
      });
    }
    
    if (!response.ok) throw new Error('Failed to generate audio');
    
    const data = await response.json();
    
    // IMPORTANT: Update podcastSegments with timing info from TTS response
    // The TTS endpoint returns segments with duration and startTime fields needed for video generation
    if (data.podcastSegments && data.podcastSegments.length > 0) {
      newscastPodcastSegments = data.podcastSegments;
      console.log('Updated podcastSegments with timing info:', 
                  newscastPodcastSegments.length, 'segments, first duration:', 
                  newscastPodcastSegments[0]?.duration);
    }
    
    // Show warning if podcast had issues
    if (data.warning) {
      const transcriptEl = document.getElementById('newscastTranscript');
      if (transcriptEl) {
        transcriptEl.innerHTML = `<div class="mb-2 p-2 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 rounded text-sm">${data.warning}</div>` + transcriptEl.innerHTML;
      }
    }
    
    newscastAudioUrl = data.audioUrl;
    newscastShareUrl = data.shareUrl || null;
    saveNewscastToStorage();
    
    // Determine guest from podcast segments if available
    let detectedGuest = null;
    if (newscastPodcastSegments && newscastPodcastSegments.length > 0) {
      const speakers = [...new Set(newscastPodcastSegments.map(s => s.speaker).filter(Boolean))];
      detectedGuest = speakers.find(s => s !== selectedPresenter) || null;
    }
    
    // Save to history (include all info needed for video generation)
    // podcastSegments now includes duration/startTime for segment-based video switching
    saveNewscastHistory({
      text: newscastText,
      presenter: selectedPresenter,
      guest: detectedGuest,
      isPodcast: newscastIsPodcast,
      podcastSegments: newscastPodcastSegments,
      audioUrl: newscastAudioUrl
    });
    
    // Update history count
    const countEl = document.getElementById('newscastHistoryCount');
    if (countEl) countEl.textContent = `${newscastHistory.length} broadcast${newscastHistory.length !== 1 ? 's' : ''}`;
    
    const audioData = atob(data.audio);
    const audioArray = new Uint8Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      audioArray[i] = audioData.charCodeAt(i);
    }
    const audioBlob = new Blob([audioArray], { type: 'audio/mp3' });
    const audioUrl = URL.createObjectURL(audioBlob);
    
    newscastAudio = new Audio(audioUrl);
    
    newscastAudio.addEventListener('loadedmetadata', () => {
      progressContainer?.classList.remove('hidden');
      updateNewscastDuration();
    });
    
    newscastAudio.addEventListener('timeupdate', updateNewscastProgress);
    
    newscastAudio.addEventListener('ended', () => {
      newscastIsPlaying = false;
      playIcon?.classList.remove('hidden');
      pauseIcon?.classList.add('hidden');
      statusEl.textContent = 'Finished';
    });
    
    newscastAudio.play();
    newscastIsPlaying = true;
    playIcon?.classList.add('hidden');
    pauseIcon?.classList.remove('hidden');
    statusEl.textContent = 'Playing...';
    
  } catch (e) {
    console.error('Newscast audio error:', e);
    statusEl.textContent = 'Audio error';
  } finally {
    playBtn.disabled = false;
  }
}

function updateNewscastProgress() {
  if (!newscastAudio) return;
  
  const currentTimeEl = document.getElementById('newscastCurrentTime');
  const progressBar = document.getElementById('newscastProgressBar');
  
  const current = newscastAudio.currentTime;
  const duration = newscastAudio.duration || 1;
  const percent = (current / duration) * 100;
  
  if (currentTimeEl) {
    const mins = Math.floor(current / 60);
    const secs = Math.floor(current % 60);
    currentTimeEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  
  if (progressBar) {
    progressBar.style.width = `${percent}%`;
  }
}

function updateNewscastDuration() {
  if (!newscastAudio) return;
  
  const durationEl = document.getElementById('newscastDuration');
  const duration = newscastAudio.duration || 0;
  
  if (durationEl) {
    const mins = Math.floor(duration / 60);
    const secs = Math.floor(duration % 60);
    durationEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

