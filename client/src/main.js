let currentTranslation = null;
let historyItems = [];

const elements = {
  menuToggle: document.getElementById('menuToggle'),
  sidebar: document.getElementById('sidebar'),
  overlay: document.getElementById('overlay'),
  darkModeToggle: document.getElementById('darkModeToggle'),
  dropZone: document.getElementById('dropZone'),
  fileInput: document.getElementById('fileInput'),
  inputText: document.getElementById('inputText'),
  bookTitle: document.getElementById('bookTitle'),
  authorName: document.getElementById('authorName'),
  customInstructions: document.getElementById('customInstructions'),
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
  downloadBtn: document.getElementById('downloadBtn'),
  historyList: document.getElementById('historyList')
};

function initDarkMode() {
  const isDark = localStorage.getItem('darkMode') === 'true' || 
    (!localStorage.getItem('darkMode') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}

function toggleDarkMode() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('darkMode', isDark);
}

function toggleSidebar(show) {
  const isVisible = show ?? elements.sidebar.classList.contains('-translate-x-full');
  elements.sidebar.classList.toggle('-translate-x-full', !isVisible);
  elements.overlay.classList.toggle('hidden', !isVisible);
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

async function translate() {
  const text = elements.inputText.value.trim();
  if (!text) {
    alert('Please enter or upload some text to translate');
    return;
  }

  elements.translateBtn.disabled = true;
  elements.progressSection.classList.remove('hidden');
  elements.outputSection.classList.add('hidden');
  
  updateProgress(0, 'Starting translation...');

  try {
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        title: elements.bookTitle.value,
        author: elements.authorName.value,
        customInstructions: elements.customInstructions.value
      })
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
            currentTranslation = {
              id: data.id,
              title: elements.bookTitle.value || fullText.slice(0, 30),
              author: elements.authorName.value,
              originalText: text,
              translatedText: fullText,
              customInstructions: elements.customInstructions.value,
              chapters,
              date: new Date().toISOString()
            };
          }
        } catch (e) {}
      }
    }

    elements.translatedText.textContent = fullText;
    elements.outputSection.classList.remove('hidden');
    
    if (chapters.length > 1) {
      elements.chaptersPreview.classList.remove('hidden');
      elements.chapterCount.textContent = chapters.length;
    } else {
      elements.chaptersPreview.classList.add('hidden');
    }

    updateProgress(100, 'Translation complete!');
    loadHistory();

  } catch (err) {
    alert('Translation error: ' + err.message);
    updateProgress(0, 'Translation failed');
  } finally {
    elements.translateBtn.disabled = false;
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

  const pdfOption = document.querySelector('input[name="pdfOption"]:checked')?.value || 'single';
  
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

  elements.historyList.innerHTML = historyItems.map(item => `
    <div class="history-item p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors group" data-id="${item.id}">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0" onclick="loadHistoryItem('${item.id}')">
          <p class="font-medium text-gray-800 dark:text-gray-200 truncate">${item.title || 'Untitled'}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${new Date(item.date).toLocaleDateString()}</p>
        </div>
        <button onclick="deleteHistoryItem('${item.id}', event)" class="p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');

  elements.historyList.scrollTop = 0;
}

window.loadHistoryItem = async function(id) {
  try {
    const res = await fetch(`/api/history/${id}`);
    const item = await res.json();
    
    elements.inputText.value = item.originalText || '';
    elements.bookTitle.value = item.title || '';
    elements.authorName.value = item.author || '';
    elements.customInstructions.value = item.customInstructions || '';
    elements.translatedText.textContent = item.translatedText || '';
    
    currentTranslation = item;
    
    elements.outputSection.classList.remove('hidden');
    elements.progressSection.classList.add('hidden');
    
    if (item.chapters && item.chapters.length > 1) {
      elements.chaptersPreview.classList.remove('hidden');
      elements.chapterCount.textContent = item.chapters.length;
    } else {
      elements.chaptersPreview.classList.add('hidden');
    }

    toggleSidebar(false);
  } catch (err) {
    alert('Failed to load translation: ' + err.message);
  }
};

window.deleteHistoryItem = async function(id, event) {
  event.stopPropagation();
  if (!confirm('Delete this translation?')) return;

  try {
    await fetch(`/api/history/${id}`, { method: 'DELETE' });
    loadHistory();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  initDarkMode();
  setupDragDrop();
  loadHistory();

  elements.menuToggle.addEventListener('click', () => toggleSidebar());
  elements.overlay.addEventListener('click', () => toggleSidebar(false));
  elements.darkModeToggle.addEventListener('click', toggleDarkMode);
  elements.translateBtn.addEventListener('click', translate);
  elements.copyBtn.addEventListener('click', copyTranslatedText);
  elements.downloadBtn.addEventListener('click', downloadPdf);
});
