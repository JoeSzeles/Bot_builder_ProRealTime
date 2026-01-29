import { initBotBuilder, updateChartTheme, loadBotHistory, initScreenshotHandlers } from './botBuilder.js';

let currentTranslation = null;
let historyItems = [];
let savedPrompts = [];
let abortController = null;
let currentTab = 'bot';

const elements = {
  menuToggle: document.getElementById('menuToggle'),
  promptsToggle: document.getElementById('promptsToggle'),
  sidebar: document.getElementById('sidebar'),
  promptsSidebar: document.getElementById('promptsSidebar'),
  overlay: document.getElementById('overlay'),
  overlayRight: document.getElementById('overlayRight'),
  darkModeToggle: document.getElementById('darkModeToggle'),
  dropZone: document.getElementById('dropZone'),
  fileInput: document.getElementById('fileInput'),
  inputText: document.getElementById('inputText'),
  bookTitle: document.getElementById('bookTitle'),
  authorName: document.getElementById('authorName'),
  customInstructions: document.getElementById('customInstructions'),
  customStyles: document.getElementById('customStyles'),
  storyCollection: document.getElementById('storyCollection'),
  savePrompt: document.getElementById('savePrompt'),
  autoDetectBtn: document.getElementById('autoDetectBtn'),
  translateBtn: document.getElementById('translateBtn'),
  progressSection: document.getElementById('progressSection'),
  progressBar: document.getElementById('progressBar'),
  progressPercent: document.getElementById('progressPercent'),
  progressStatus: document.getElementById('progressStatus'),
  outputSection: document.getElementById('outputSection'),
  translatedText: document.getElementById('translatedText'),
  copyBtn: document.getElementById('copyBtn'),
  chaptersPreview: document.getElementById('chaptersPreview'),
  chapterCount: document.getElementById('chapterCount'),
  splitOptionLabel: document.getElementById('splitOptionLabel'),
  downloadBtn: document.getElementById('downloadBtn'),
  historyList: document.getElementById('historyList'),
  promptsList: document.getElementById('promptsList'),
  modelSelect: document.getElementById('modelSelect'),
  cancelBtn: document.getElementById('cancelBtn'),
  tabText: document.getElementById('tabText'),
  tabBot: document.getElementById('tabBot'),
  textTabContent: document.getElementById('textTabContent'),
  botTabContent: document.getElementById('botTabContent')
};

function switchTab(tab) {
  currentTab = tab;
  
  const translationHistorySidebar = document.getElementById('translationHistorySidebar');
  const botHistorySidebar = document.getElementById('botHistorySidebar');
  const promptsSidebar = document.getElementById('promptsSidebar');
  const aiStrategySidebar = document.getElementById('aiStrategySidebar');
  
  if (tab === 'text') {
    elements.textTabContent.classList.remove('hidden');
    elements.botTabContent.classList.add('hidden');
    elements.tabText.classList.add('bg-indigo-100', 'dark:bg-indigo-900', 'text-indigo-700', 'dark:text-indigo-300');
    elements.tabText.classList.remove('text-gray-600', 'dark:text-gray-400');
    elements.tabBot.classList.remove('bg-indigo-100', 'dark:bg-indigo-900', 'text-indigo-700', 'dark:text-indigo-300');
    elements.tabBot.classList.add('text-gray-600', 'dark:text-gray-400');
    
    if (translationHistorySidebar) translationHistorySidebar.classList.remove('hidden');
    if (botHistorySidebar) botHistorySidebar.classList.add('hidden');
    if (promptsSidebar) promptsSidebar.classList.remove('hidden');
    if (aiStrategySidebar) aiStrategySidebar.classList.add('hidden');
  } else {
    elements.textTabContent.classList.add('hidden');
    elements.botTabContent.classList.remove('hidden');
    elements.tabBot.classList.add('bg-indigo-100', 'dark:bg-indigo-900', 'text-indigo-700', 'dark:text-indigo-300');
    elements.tabBot.classList.remove('text-gray-600', 'dark:text-gray-400');
    elements.tabText.classList.remove('bg-indigo-100', 'dark:bg-indigo-900', 'text-indigo-700', 'dark:text-indigo-300');
    elements.tabText.classList.add('text-gray-600', 'dark:text-gray-400');
    
    if (translationHistorySidebar) translationHistorySidebar.classList.add('hidden');
    if (botHistorySidebar) botHistorySidebar.classList.remove('hidden');
    if (promptsSidebar) promptsSidebar.classList.add('hidden');
    if (aiStrategySidebar) aiStrategySidebar.classList.remove('hidden');
    
    initBotBuilder();
    loadBotHistory();
  }
}

function updateSplitOptionLabel(isStoryMode) {
  if (elements.splitOptionLabel) {
    elements.splitOptionLabel.textContent = isStoryMode 
      ? 'One per story (ZIP)' 
      : 'One per chapter (ZIP)';
  }
}

function initDarkMode() {
  const isDark = localStorage.getItem('darkMode') === 'true' || 
    (!localStorage.getItem('darkMode') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}

function toggleDarkMode() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('darkMode', isDark);
  updateChartTheme();
}

function toggleSidebar(show) {
  const isVisible = show ?? elements.sidebar.classList.contains('-translate-x-full');
  elements.sidebar.classList.toggle('-translate-x-full', !isVisible);
  elements.overlay.classList.toggle('hidden', !isVisible);
}

function togglePromptsSidebar(show) {
  const isVisible = show ?? elements.promptsSidebar.classList.contains('translate-x-full');
  elements.promptsSidebar.classList.toggle('translate-x-full', !isVisible);
  elements.overlayRight.classList.toggle('hidden', !isVisible);
}

async function loadSavedPrompts() {
  const localPrompts = getLocalStoragePrompts();
  
  try {
    const res = await fetch('/api/prompts');
    if (!res.ok) throw new Error('Server error');
    const data = await res.json();
    savedPrompts = data.prompts || [];
    
    if (localPrompts.length > 0) {
      await migrateLocalPromptsToServer(localPrompts);
    }
    
    renderPrompts();
  } catch (err) {
    console.error('Failed to load prompts from server:', err);
    if (localPrompts.length > 0) {
      savedPrompts = localPrompts;
    }
    renderPrompts();
  }
}

function getLocalStoragePrompts() {
  try {
    const stored = localStorage.getItem('savedPrompts');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Error reading localStorage prompts:', e);
  }
  return [];
}

async function migrateLocalPromptsToServer(localPrompts) {
  try {
    const res = await fetch('/api/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: localPrompts })
    });
    const data = await res.json();
    savedPrompts = data.prompts || savedPrompts;
    
    try {
      localStorage.removeItem('savedPrompts');
    } catch (e) {}
    
    console.log('Migrated local prompts to server');
  } catch (err) {
    console.error('Failed to migrate prompts:', err);
  }
}

async function addPrompt(name, instructions, styles) {
  try {
    const res = await fetch('/api/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, instructions, styles })
    });
    const data = await res.json();
    savedPrompts = data.prompts || savedPrompts;
    renderPrompts();
  } catch (err) {
    console.error('Failed to add prompt:', err);
    alert('Failed to save prompt');
  }
}

async function deletePrompt(index) {
  try {
    const res = await fetch(`/api/prompts/${index}`, { method: 'DELETE' });
    const data = await res.json();
    savedPrompts = data.prompts || [];
    renderPrompts();
  } catch (err) {
    console.error('Failed to delete prompt:', err);
    alert('Failed to delete prompt');
  }
}

function applyPrompt(index) {
  const prompt = savedPrompts[index];
  if (prompt) {
    elements.customInstructions.value = prompt.instructions || '';
    elements.customStyles.value = prompt.styles || '';
  }
  togglePromptsSidebar(false);
}

function renderPrompts() {
  if (!savedPrompts.length) {
    elements.promptsList.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400 p-2">No saved prompts yet</p>';
    return;
  }

  elements.promptsList.innerHTML = savedPrompts.map((prompt, index) => `
    <div class="prompt-item p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors group" data-prompt-index="${index}">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0 prompt-content">
          <p class="font-medium text-gray-800 dark:text-gray-200 truncate">${prompt.name || 'Untitled Prompt'}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">${prompt.styles || 'No style specified'}</p>
          <p class="text-xs text-gray-400 dark:text-gray-500 mt-1 line-clamp-2">${(prompt.instructions || '').slice(0, 80)}${(prompt.instructions || '').length > 80 ? '...' : ''}</p>
        </div>
        <button class="delete-prompt-btn p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" data-prompt-index="${index}">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

function setupPromptsEventDelegation() {
  elements.promptsList.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.delete-prompt-btn');
    if (deleteBtn) {
      e.stopPropagation();
      const index = parseInt(deleteBtn.dataset.promptIndex, 10);
      if (!confirm('Delete this prompt?')) return;
      deletePrompt(index);
      return;
    }
    
    const promptItem = e.target.closest('.prompt-item');
    if (promptItem) {
      const index = parseInt(promptItem.dataset.promptIndex, 10);
      applyPrompt(index);
    }
  });
}

function setupDragDrop() {
  const dropZone = elements.dropZone;
  const fileInput = elements.fileInput;

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
    dropZone.addEventListener(event, e => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  ['dragenter', 'dragover'].forEach(event => {
    dropZone.addEventListener(event, () => dropZone.classList.add('dragover'));
  });

  ['dragleave', 'drop'].forEach(event => {
    dropZone.addEventListener(event, () => dropZone.classList.remove('dragover'));
  });

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
  fileInput.addEventListener('change', e => handleFiles(e.target.files));
}

async function handleFiles(files) {
  if (!files.length) return;
  
  const file = files[0];
  const ext = file.name.split('.').pop().toLowerCase();
  
  if (!['txt', 'pdf', 'md'].includes(ext)) {
    alert('Please upload a .txt, .pdf, or .md file');
    return;
  }

  if (ext === 'pdf') {
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await fetch('/api/parse-pdf', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      elements.inputText.value = data.text;
    } catch (err) {
      alert('Error parsing PDF: ' + err.message);
    }
  } else {
    const text = await file.text();
    elements.inputText.value = text;
  }
  
  if (!elements.bookTitle.value) {
    elements.bookTitle.value = file.name.replace(/\.[^/.]+$/, '');
  }
}

async function autoDetect() {
  const text = elements.inputText.value.trim();
  if (!text) {
    alert('Please enter or upload some text first');
    return;
  }

  elements.autoDetectBtn.disabled = true;
  elements.autoDetectBtn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Detecting...';

  try {
    const response = await fetch('/api/detect-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 5000) })
    });
    
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    
    if (data.title && !elements.bookTitle.value) {
      elements.bookTitle.value = data.title;
    }
    if (data.author && !elements.authorName.value) {
      elements.authorName.value = data.author;
    }
  } catch (err) {
    console.error('Auto-detect error:', err);
    alert('Could not auto-detect title/author. Please enter manually.');
  } finally {
    elements.autoDetectBtn.disabled = false;
    elements.autoDetectBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg> Auto-detect Title & Author from Text';
  }
}

async function translate() {
  const text = elements.inputText.value.trim();
  const customInstructions = elements.customInstructions.value.trim();
  const customStyles = elements.customStyles.value.trim();
  
  // Allow either text input OR topic/instructions for generation mode
  if (!text && !customInstructions) {
    alert('Please enter some text to transform, or provide a topic in the Topic/Instructions field to generate new content');
    return;
  }

  const shouldSavePrompt = elements.savePrompt.checked;
  const isGenerationMode = !text && customInstructions;

  if (shouldSavePrompt && (customInstructions || customStyles)) {
    const promptName = elements.bookTitle.value || `Prompt ${new Date().toLocaleDateString()}`;
    await addPrompt(promptName, customInstructions, customStyles);
  }

  elements.translateBtn.disabled = true;
  elements.progressSection.classList.remove('hidden');
  elements.outputSection.classList.add('hidden');
  
  updateProgress(0, isGenerationMode ? 'Generating content...' : 'Starting translation...');

  // Setup abort controller for cancellation
  abortController = new AbortController();
  const selectedModel = elements.modelSelect.value;

  try {
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        title: elements.bookTitle.value,
        author: elements.authorName.value,
        customInstructions: customInstructions,
        customStyles: customStyles,
        isStoryCollection: elements.storyCollection.checked,
        model: selectedModel
      }),
      signal: abortController.signal
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let chapters = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(6));
          
          if (data.progress !== undefined) {
            updateProgress(data.progress, data.status);
          }
          
          if (data.chunk) {
            fullText += data.chunk;
          }
          
          if (data.complete) {
            fullText = data.translatedText;
            chapters = data.chapters || [];
            const userRequestedStoryMode = elements.storyCollection.checked;
            const effectiveStoryMode = data.isStoryCollection !== undefined ? data.isStoryCollection : userRequestedStoryMode;
            currentTranslation = {
              id: data.id,
              title: elements.bookTitle.value || data.title || fullText.slice(0, 30),
              author: elements.authorName.value || data.author,
              originalText: text,
              translatedText: fullText,
              customInstructions: customInstructions,
              customStyles: customStyles,
              chapters,
              stories: data.stories || [],
              isStoryCollection: effectiveStoryMode,
              userRequestedStoryMode: userRequestedStoryMode,
              date: new Date().toISOString()
            };
            elements.storyCollection.checked = effectiveStoryMode;
            if (data.title && !elements.bookTitle.value) {
              elements.bookTitle.value = data.title;
            }
            if (data.author && !elements.authorName.value) {
              elements.authorName.value = data.author;
            }
          }
        } catch (e) {}
      }
    }

    elements.translatedText.textContent = fullText;
    elements.outputSection.classList.remove('hidden');
    
    const stories = currentTranslation?.stories || [];
    const isStoryMode = currentTranslation?.isStoryCollection || false;
    const requestedStoryMode = currentTranslation?.userRequestedStoryMode || false;
    
    if (requestedStoryMode && !isStoryMode) {
      alert('No individual stories detected. The entire text will be treated as one document.');
    }
    
    updateSplitOptionLabel(isStoryMode);
    
    if (isStoryMode && stories.length > 1) {
      elements.chaptersPreview.classList.remove('hidden');
      elements.chapterCount.textContent = stories.length + ' stories';
    } else if (chapters.length > 1) {
      elements.chaptersPreview.classList.remove('hidden');
      elements.chapterCount.textContent = chapters.length + ' chapters';
    } else {
      elements.chaptersPreview.classList.add('hidden');
    }

    updateProgress(100, 'Complete!');
    loadHistory();

  } catch (err) {
    if (err.name === 'AbortError') {
      updateProgress(0, 'Cancelled');
    } else {
      alert('Error: ' + err.message);
      updateProgress(0, 'Failed');
    }
  } finally {
    elements.translateBtn.disabled = false;
    abortController = null;
  }
}

function cancelGeneration() {
  if (abortController) {
    abortController.abort();
    abortController = null;
    elements.progressSection.classList.add('hidden');
    elements.translateBtn.disabled = false;
    updateProgress(0, 'Cancelled');
  }
}

function updateProgress(percent, status) {
  elements.progressBar.style.width = percent + '%';
  elements.progressPercent.textContent = Math.round(percent) + '%';
  elements.progressStatus.textContent = status;
}

async function copyTranslatedText() {
  const text = elements.translatedText.textContent;
  await navigator.clipboard.writeText(text);
  
  const btn = elements.copyBtn;
  const originalText = btn.innerHTML;
  btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Copied!';
  setTimeout(() => btn.innerHTML = originalText, 2000);
}

async function downloadPdf() {
  if (!currentTranslation) return;

  let pdfOption = document.querySelector('input[name="pdfOption"]:checked')?.value || 'single';
  
  const isStoryMode = currentTranslation.isStoryCollection;
  const hasStories = isStoryMode && currentTranslation.stories && currentTranslation.stories.length > 1;
  const hasChapters = currentTranslation.chapters && currentTranslation.chapters.length > 1;
  
  if (pdfOption === 'chapters' && !hasStories && !hasChapters) {
    pdfOption = 'single';
  }
  
  elements.downloadBtn.disabled = true;
  elements.downloadBtn.innerHTML = '<svg class="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Generating...';

  try {
    const response = await fetch('/api/generate-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: currentTranslation.id,
        option: pdfOption
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    const link = document.createElement('a');
    link.href = data.downloadUrl;
    link.download = data.filename;
    link.click();

  } catch (err) {
    alert('PDF generation error: ' + err.message);
  } finally {
    elements.downloadBtn.disabled = false;
    elements.downloadBtn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg> Generate & Download PDF';
  }
}

async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    historyItems = data.items || [];
    renderHistory();
  } catch (err) {
    console.error('Failed to load history:', err);
  }
}

function renderHistory() {
  if (!historyItems.length) {
    elements.historyList.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400 p-2">No translations yet</p>';
    return;
  }

  elements.historyList.innerHTML = historyItems.map(item => {
    const hasStories = item.stories && item.stories.length > 1;
    const storiesHtml = hasStories ? `
      <div class="stories-list mt-2 ml-4 space-y-1 hidden" data-stories-for="${item.id}">
        ${item.stories.map((story, idx) => `
          <div class="story-item text-xs text-gray-500 dark:text-gray-400 py-1 px-2 rounded hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer" data-history-id="${item.id}" data-story-index="${idx}">
            ${idx + 1}. ${story.title || 'Untitled Story'}
          </div>
        `).join('')}
      </div>
    ` : '';

    const expandBtn = hasStories ? `
      <button class="expand-stories-btn p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" data-expand-for="${item.id}">
        <svg class="w-4 h-4 transform transition-transform" data-expand-icon="${item.id}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>
    ` : '';

    return `
      <div class="history-item p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group" data-history-id="${item.id}">
        <div class="flex items-start justify-between gap-2">
          ${expandBtn}
          <div class="flex-1 min-w-0 cursor-pointer history-content" data-history-id="${item.id}">
            <p class="font-medium text-gray-800 dark:text-gray-200 truncate">${item.title || 'Untitled'}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${new Date(item.date).toLocaleDateString()}${hasStories ? ` · ${item.stories.length} stories` : ''}</p>
          </div>
          <button class="delete-history-btn p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" data-history-id="${item.id}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
          </button>
        </div>
        ${storiesHtml}
      </div>
    `;
  }).join('');

  elements.historyList.scrollTop = 0;
}

function setupHistoryEventDelegation() {
  elements.historyList.addEventListener('click', async (e) => {
    const expandBtn = e.target.closest('.expand-stories-btn');
    if (expandBtn) {
      e.stopPropagation();
      const id = expandBtn.dataset.expandFor;
      const storiesList = document.querySelector(`[data-stories-for="${id}"]`);
      const expandIcon = document.querySelector(`[data-expand-icon="${id}"]`);
      if (storiesList) {
        storiesList.classList.toggle('hidden');
        expandIcon?.classList.toggle('rotate-180');
      }
      return;
    }
    
    const deleteBtn = e.target.closest('.delete-history-btn');
    if (deleteBtn) {
      e.stopPropagation();
      const id = deleteBtn.dataset.historyId;
      if (!confirm('Delete this translation?')) return;
      try {
        await fetch(`/api/history/${id}`, { method: 'DELETE' });
        loadHistory();
      } catch (err) {
        alert('Failed to delete: ' + err.message);
      }
      return;
    }
    
    const storyItem = e.target.closest('.story-item');
    if (storyItem) {
      e.stopPropagation();
      const id = storyItem.dataset.historyId;
      const storyIndex = parseInt(storyItem.dataset.storyIndex, 10);
      try {
        const res = await fetch(`/api/history/${id}`);
        const item = await res.json();
        
        if (item.stories && item.stories[storyIndex]) {
          const story = item.stories[storyIndex];
          elements.translatedText.textContent = story.content || '';
          elements.outputSection.classList.remove('hidden');
          elements.progressSection.classList.add('hidden');
          elements.chaptersPreview.classList.add('hidden');
        }
        
        toggleSidebar(false);
      } catch (err) {
        alert('Failed to load story: ' + err.message);
      }
      return;
    }
    
    const historyContent = e.target.closest('.history-content');
    if (historyContent) {
      const id = historyContent.dataset.historyId;
      await loadHistoryItem(id);
    }
  });
}

async function loadHistoryItem(id) {
  try {
    const res = await fetch(`/api/history/${id}`);
    const item = await res.json();
    
    elements.inputText.value = item.originalText || '';
    elements.bookTitle.value = item.title || '';
    elements.authorName.value = item.author || '';
    elements.customInstructions.value = item.customInstructions || '';
    elements.customStyles.value = item.customStyles || '';
    elements.translatedText.textContent = item.translatedText || '';
    elements.storyCollection.checked = item.isStoryCollection || false;
    
    currentTranslation = item;
    
    elements.outputSection.classList.remove('hidden');
    elements.progressSection.classList.add('hidden');
    
    const hasValidStories = item.stories && item.stories.length > 1;
    const hasChapters = item.chapters && item.chapters.length > 1;
    
    const effectiveStoryMode = item.isStoryCollection && hasValidStories;
    elements.storyCollection.checked = effectiveStoryMode;
    currentTranslation.isStoryCollection = effectiveStoryMode;
    
    updateSplitOptionLabel(effectiveStoryMode);
    
    if (effectiveStoryMode) {
      elements.chaptersPreview.classList.remove('hidden');
      elements.chapterCount.textContent = item.stories.length + ' stories';
    } else if (hasChapters) {
      elements.chaptersPreview.classList.remove('hidden');
      elements.chapterCount.textContent = item.chapters.length + ' chapters';
    } else {
      elements.chaptersPreview.classList.add('hidden');
    }

    toggleSidebar(false);
  } catch (err) {
    alert('Failed to load translation: ' + err.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initDarkMode();
  setupDragDrop();
  setupHistoryEventDelegation();
  setupPromptsEventDelegation();
  loadHistory();
  loadSavedPrompts();
  initScreenshotHandlers();

  elements.menuToggle.addEventListener('click', () => toggleSidebar());
  elements.promptsToggle.addEventListener('click', () => togglePromptsSidebar());
  elements.overlay.addEventListener('click', () => toggleSidebar(false));
  elements.overlayRight.addEventListener('click', () => togglePromptsSidebar(false));
  elements.darkModeToggle.addEventListener('click', toggleDarkMode);
  elements.autoDetectBtn.addEventListener('click', autoDetect);
  elements.translateBtn.addEventListener('click', translate);
  elements.cancelBtn.addEventListener('click', cancelGeneration);
  elements.copyBtn.addEventListener('click', copyTranslatedText);
  elements.downloadBtn.addEventListener('click', downloadPdf);
  const isBot = currentTab === 'bot';
  elements.textTabContent.classList.toggle('hidden', isBot);
  elements.botTabContent.classList.toggle('hidden', !isBot);
  
  if (isBot) {
    elements.tabBot.classList.add('bg-indigo-100', 'dark:bg-indigo-900', 'text-indigo-700', 'dark:text-indigo-300');
    elements.tabText.classList.add('text-gray-600', 'dark:text-gray-400');
    if (document.getElementById('translationHistorySidebar')) document.getElementById('translationHistorySidebar').classList.add('hidden');
    if (document.getElementById('botHistorySidebar')) document.getElementById('botHistorySidebar').classList.remove('hidden');
    if (document.getElementById('promptsSidebar')) document.getElementById('promptsSidebar').classList.add('hidden');
    if (document.getElementById('aiStrategySidebar')) document.getElementById('aiStrategySidebar').classList.remove('hidden');
    initBotBuilder();
    loadBotHistory();
    // Default to forecast tab within bot builder
    import('./botBuilder.js').then(({ switchBotTab }) => {
      if (typeof switchBotTab === 'function') switchBotTab('forecast');
    }).catch(e => console.error('Failed to switch bot tab:', e));
  }

  elements.tabText.addEventListener('click', () => switchTab('text'));
  elements.tabBot.addEventListener('click', () => switchTab('bot'));
  
  // Donation modal
  const donateBtn = document.getElementById('donateBtn');
  const donationModal = document.getElementById('donationModal');
  const closeDonationModal = document.getElementById('closeDonationModal');
  const donationModalOverlay = document.getElementById('donationModalOverlay');
  
  if (donateBtn && donationModal) {
    donateBtn.addEventListener('click', () => {
      donationModal.classList.remove('hidden');
    });
    closeDonationModal?.addEventListener('click', () => {
      donationModal.classList.add('hidden');
    });
    donationModalOverlay?.addEventListener('click', () => {
      donationModal.classList.add('hidden');
    });
  }
  
  switchTab('bot');
});
