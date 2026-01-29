import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import JSZip from 'jszip';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import pLimit from 'p-limit';
import pRetry from 'p-retry';
import * as cheerio from 'cheerio';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
const PdfPrinter = require('pdfmake');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

app.use('/downloads', express.static(DOWNLOADS_DIR));
app.use('/images', express.static(path.join(__dirname, '..', 'client', 'public', 'images')));

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY
});

const FONTS_DIR = path.join(__dirname, '..', 'fonts');
const fonts = {
  Roboto: {
    normal: path.join(FONTS_DIR, 'Roboto-Regular.ttf'),
    bold: path.join(FONTS_DIR, 'Roboto-Medium.ttf'),
    italics: path.join(FONTS_DIR, 'Roboto-Italic.ttf'),
    bolditalics: path.join(FONTS_DIR, 'Roboto-MediumItalic.ttf')
  }
};

const DATA_DIR = path.join(__dirname, '..', 'data');
const BOT_DATA_DIR = path.join(__dirname, '..', 'data', 'bots');
const BOT_SCREENSHOTS_DIR = path.join(__dirname, '..', 'data', 'bots', 'screenshots');
const PRT_DOCS_DIR = path.join(__dirname, '..', 'data', 'prt-docs');
const MAX_ENTRIES_PER_FILE = 10;

let prtDocsCache = null;
let prtDocsCacheMtime = 0;

function loadPrtDocs() {
  const indexPath = path.join(PRT_DOCS_DIR, 'index.json');
  if (!fs.existsSync(indexPath)) return { docs: [], content: {} };
  
  const stat = fs.statSync(indexPath);
  if (prtDocsCache && stat.mtimeMs === prtDocsCacheMtime) {
    return prtDocsCache;
  }
  
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const content = {};
    
    for (const doc of index.docs) {
      const filePath = path.join(PRT_DOCS_DIR, doc.file);
      if (fs.existsSync(filePath)) {
        content[doc.id] = fs.readFileSync(filePath, 'utf-8');
      }
    }
    
    prtDocsCache = { docs: index.docs, content };
    prtDocsCacheMtime = stat.mtimeMs;
    return prtDocsCache;
  } catch (e) {
    console.error('Error loading PRT docs:', e.message);
    return { docs: [], content: {} };
  }
}

function getRelevantPrtDocs(description = '', settings = {}) {
  const { docs, content } = loadPrtDocs();
  const relevantDocs = [];
  const descLower = description.toLowerCase();
  const settingsStr = JSON.stringify(settings).toLowerCase();
  const combined = descLower + ' ' + settingsStr;
  
  for (const doc of docs) {
    if (doc.alwaysInclude) {
      relevantDocs.push({ title: doc.title, content: content[doc.id] });
      continue;
    }
    
    for (const keyword of doc.keywords) {
      if (combined.includes(keyword.toLowerCase())) {
        relevantDocs.push({ title: doc.title, content: content[doc.id] });
        break;
      }
    }
  }
  
  return relevantDocs;
}

function buildPrtDocsPrompt(docs) {
  if (docs.length === 0) return '';
  
  let prompt = '\n\n=== PROREALTIME REFERENCE DOCUMENTATION ===\n';
  prompt += 'The following documentation contains CRITICAL syntax rules and examples. Follow these exactly:\n\n';
  
  for (const doc of docs) {
    prompt += `--- ${doc.title} ---\n${doc.content}\n\n`;
  }
  
  prompt += '=== END REFERENCE DOCUMENTATION ===\n';
  return prompt;
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(BOT_DATA_DIR)) {
  fs.mkdirSync(BOT_DATA_DIR, { recursive: true });
}
if (!fs.existsSync(BOT_SCREENSHOTS_DIR)) {
  fs.mkdirSync(BOT_SCREENSHOTS_DIR, { recursive: true });
}

// File rotation helpers
function getActiveFile(baseName) {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith(baseName) && f.endsWith('.json'))
    .sort()
    .reverse();
  
  if (files.length === 0) {
    return path.join(DATA_DIR, `${baseName}.json`);
  }
  
  const latestFile = path.join(DATA_DIR, files[0]);
  try {
    const data = JSON.parse(fs.readFileSync(latestFile, 'utf-8'));
    const entryCount = baseName === 'translations' ? Object.keys(data).length : (data.prompts?.length || 0);
    
    if (entryCount >= MAX_ENTRIES_PER_FILE) {
      const timestamp = Date.now();
      return path.join(DATA_DIR, `${baseName}_${timestamp}.json`);
    }
  } catch (e) {
    // File corrupted or empty, create new
    const timestamp = Date.now();
    return path.join(DATA_DIR, `${baseName}_${timestamp}.json`);
  }
  
  return latestFile;
}

function getAllFiles(baseName) {
  return fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith(baseName) && f.endsWith('.json'))
    .map(f => path.join(DATA_DIR, f))
    .sort()
    .reverse();
}

const SUNO_TEMPLATE = {
  name: 'Suno Song Format',
  instructions: `Do not translate it into different language. Turn the provided text into a complete Suno-compatible song, using the following required formatting rules and musical structure.

📌 FORMATTING RULES (MANDATORY)

All section labels must be written inside brackets [ ], including:

[Intro]

[Verse 1], [Verse 2], …

[Chorus]

[Pre-Chorus]

[Bridge]

[Outro]

Any timing or description cues.

Lyrics themselves must NOT be inside brackets.
Brackets are only for instructions/titles/sections.

If musical directions appear, also put them in brackets, e.g.:

[Slow atmospheric intro with drone note]

[Chanting fades in]

Maintain poetic flow but stay loyal to the meaning of the source text.

Keep sections clear and Suno-friendly.`,
  styles: 'Electronic ambient, atmospheric, cinematic'
};

// Load all translations from all files
function loadAllTranslations() {
  const allData = {};
  const files = getAllFiles('translations');
  
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      Object.assign(allData, data);
    } catch (e) {
      console.error(`Error loading ${file}:`, e);
    }
  }
  
  return allData;
}

// Load from active file only for saving
function loadActiveDB() {
  const activeFile = getActiveFile('translations');
  try {
    if (fs.existsSync(activeFile)) {
      return { file: activeFile, data: JSON.parse(fs.readFileSync(activeFile, 'utf-8')) };
    }
  } catch (e) {}
  return { file: activeFile, data: {} };
}

function saveDB(id, entry) {
  const { file, data } = loadActiveDB();
  
  // Check if we need to rotate
  if (Object.keys(data).length >= MAX_ENTRIES_PER_FILE) {
    const newFile = path.join(DATA_DIR, `translations_${Date.now()}.json`);
    fs.writeFileSync(newFile, JSON.stringify({ [id]: entry }, null, 2));
  } else {
    data[id] = entry;
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }
}

// Load all prompts from all files
function loadAllPrompts() {
  const allPrompts = [];
  const files = getAllFiles('prompts');
  
  if (files.length === 0) {
    return [SUNO_TEMPLATE];
  }
  
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (data.prompts && Array.isArray(data.prompts)) {
        allPrompts.push(...data.prompts);
      }
    } catch (e) {
      console.error(`Error loading ${file}:`, e);
    }
  }
  
  if (allPrompts.length === 0) {
    return [SUNO_TEMPLATE];
  }
  
  return allPrompts;
}

function loadActivePrompts() {
  const activeFile = getActiveFile('prompts');
  try {
    if (fs.existsSync(activeFile)) {
      const data = JSON.parse(fs.readFileSync(activeFile, 'utf-8'));
      return { file: activeFile, prompts: data.prompts || [] };
    }
  } catch (e) {}
  return { file: activeFile, prompts: [] };
}

function savePrompts(allPrompts) {
  // Get all existing prompts files
  const files = getAllFiles('prompts');
  
  if (files.length === 0) {
    // No files exist, create the first one
    const newFile = path.join(DATA_DIR, 'prompts.json');
    fs.writeFileSync(newFile, JSON.stringify({ prompts: allPrompts }, null, 2));
    return;
  }
  
  // Distribute prompts across files, max 10 per file
  let promptsToSave = [...allPrompts];
  let fileIndex = 0;
  
  while (promptsToSave.length > 0) {
    const chunk = promptsToSave.splice(0, MAX_ENTRIES_PER_FILE);
    let targetFile;
    
    if (fileIndex < files.length) {
      targetFile = files[fileIndex];
    } else {
      targetFile = path.join(DATA_DIR, `prompts_${Date.now()}.json`);
    }
    
    fs.writeFileSync(targetFile, JSON.stringify({ prompts: chunk }, null, 2));
    fileIndex++;
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function chunkText(text, maxChars = 4000) {
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';

  for (const para of paragraphs) {
    if ((currentChunk + para).length > maxChars && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = para + '\n\n';
    } else {
      currentChunk += para + '\n\n';
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

function detectChapters(text) {
  const chapterPatterns = [
    /^(Chapter\s+\d+[:\.]?\s*.*)$/gim,
    /^(CHAPTER\s+[IVXLCDM]+[:\.]?\s*.*)$/gim,
    /^(Part\s+\d+[:\.]?\s*.*)$/gim,
    /^(\d+\.\s+.*)$/gim
  ];

  const chapters = [];
  let lastIndex = 0;

  for (const pattern of chapterPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      chapters.push({
        title: match[1].trim(),
        start: match.index
      });
    }
    if (chapters.length > 0) break;
  }

  if (chapters.length === 0) {
    return [{ title: 'Full Text', content: text }];
  }

  chapters.sort((a, b) => a.start - b.start);

  const result = [];
  for (let i = 0; i < chapters.length; i++) {
    const start = chapters[i].start;
    const end = i < chapters.length - 1 ? chapters[i + 1].start : text.length;
    result.push({
      title: chapters[i].title,
      content: text.slice(start, end).trim()
    });
  }

  return result;
}

async function detectMetadata(text) {
  const preview = text.slice(0, 3000);
  
  try {
    const message = await anthropic.messages.create({
      model: 'gpt-4o',
      max_tokens: 500,
      system: 'You are a literary expert. Extract the book/collection title and author name from the given text. Respond ONLY with valid JSON: {"title": "...", "author": "..."} or {"title": null, "author": null} if not found.',
      messages: [{ role: 'user', content: `Extract the title and author from this text:\n\n${preview}` }]
    });
    
    const content = message.content[0]?.text || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Metadata detection error:', e);
  }
  return { title: null, author: null };
}

async function detectStories(text) {
  const preview = text.slice(0, 10000);
  
  try {
    const message = await anthropic.messages.create({
      model: 'gpt-4o',
      max_tokens: 2000,
      system: `You are a literary expert. Analyze this text to find individual stories in a collection.
For each story, identify its title and the exact text that starts it.
Respond ONLY with valid JSON array: [{"title": "Story Title", "startMarker": "exact first 30-50 chars of story"}]
If this is not a story collection or you cannot identify stories, respond with: []`,
      messages: [{ role: 'user', content: preview }]
    });
    
    const content = message.content[0]?.text || '';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Story detection error:', e);
  }
  return [];
}

function splitTextByStories(text, storyMarkers) {
  if (!storyMarkers || storyMarkers.length === 0) {
    return [{ title: 'Full Text', content: text }];
  }

  const stories = [];
  const positions = [];
  
  for (const marker of storyMarkers) {
    const idx = text.indexOf(marker.startMarker);
    if (idx !== -1) {
      positions.push({ title: marker.title, start: idx });
    }
  }
  
  positions.sort((a, b) => a.start - b.start);
  
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].start;
    const end = i < positions.length - 1 ? positions[i + 1].start : text.length;
    stories.push({
      title: positions[i].title,
      content: text.slice(start, end).trim()
    });
  }
  
  return stories.length > 0 ? stories : [{ title: 'Full Text', content: text }];
}

function isRateLimitError(error) {
  const errorMsg = error?.message || String(error);
  return (
    errorMsg.includes('429') ||
    errorMsg.includes('RATELIMIT_EXCEEDED') ||
    errorMsg.toLowerCase().includes('quota') ||
    errorMsg.toLowerCase().includes('rate limit')
  );
}

function buildTranslationPrompts(customInstructions, customStyles) {
  const hasNoTranslateInstruction = customInstructions && 
    (customInstructions.toLowerCase().includes('do not translate') ||
     customInstructions.toLowerCase().includes('don\'t translate') ||
     customInstructions.toLowerCase().includes('keep original language') ||
     customInstructions.toLowerCase().includes('keep the original language') ||
     customInstructions.toLowerCase().includes('same language') ||
     customInstructions.toLowerCase().includes('original language'));

  let systemPrompt = 'You are an expert literary translator and text processor. Preserve the author\'s voice, style, and emotional nuance. Maintain paragraph structure and any formatting.';
  
  if (hasNoTranslateInstruction) {
    systemPrompt += '\n\nCRITICAL: The user has explicitly requested to keep the original language. DO NOT translate into English or any other language. Process the text according to their instructions while keeping the EXACT same language as the input.';
  }

  let userPrompt = '';
  
  if (customInstructions) {
    userPrompt += `INSTRUCTIONS (FOLLOW EXACTLY):\n${customInstructions}\n\n`;
  }
  
  if (customStyles) {
    userPrompt += `STYLE GUIDELINES:\n${customStyles}\n\n`;
  }
  
  if (hasNoTranslateInstruction) {
    userPrompt += `Process the following text according to the instructions above. IMPORTANT: Keep the text in its ORIGINAL LANGUAGE - do NOT translate:\n\n`;
  } else {
    userPrompt += `Translate the following text to beautiful, natural English:\n\n`;
  }
  
  return { systemPrompt, userPromptPrefix: userPrompt };
}

function isClaudeModel(model) {
  return model.startsWith('claude');
}

async function callAI(systemPrompt, userPrompt, model) {
  if (isClaudeModel(model)) {
    const message = await anthropic.messages.create({
      model: model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    const content = message.content[0];
    if (content.type === 'text') {
      return content.text;
    }
    throw new Error('Unexpected response type');
  } else {
    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 8192
    });
    return response.choices[0]?.message?.content || '';
  }
}

async function translateChunk(text, customInstructions, customStyles, model = 'claude-sonnet-4-5') {
  const { systemPrompt, userPromptPrefix } = buildTranslationPrompts(customInstructions, customStyles);
  const userPrompt = userPromptPrefix + text;

  return pRetry(
    async () => {
      try {
        return await callAI(systemPrompt, userPrompt, model);
      } catch (error) {
        if (isRateLimitError(error)) {
          throw error;
        }
        // Fallback to gpt-4o-mini if primary model fails
        if (isClaudeModel(model)) {
          console.log(`${model} failed, falling back to gpt-4o-mini`);
          return await callAI(systemPrompt, userPrompt, 'gpt-4o-mini');
        }
        throw new pRetry.AbortError(error);
      }
    },
    {
      retries: 5,
      minTimeout: 2000,
      maxTimeout: 60000,
      factor: 2
    }
  );
}

// Content generation mode - research topic and write in requested style
async function generateContent(topic, customStyles, model = 'claude-sonnet-4-5') {
  const systemPrompt = `You are an expert writer and researcher. Your task is to research and write comprehensive, engaging content about the topic provided by the user. 

Your writing should be:
- Well-researched and informative
- Engaging and readable
- Properly structured with clear sections
- Original and creative in presentation

If the user specifies a particular style or format, follow it exactly. If they want song lyrics, write song lyrics. If they want poetry, write poetry. If they want an essay, write an essay.`;

  let userPrompt = `TOPIC/INSTRUCTIONS:\n${topic}\n\n`;
  
  if (customStyles) {
    userPrompt += `OUTPUT STYLE & FORMAT:\n${customStyles}\n\n`;
  }
  
  userPrompt += `Please write comprehensive content about this topic in the specified style and format. Be creative, thorough, and engaging.`;

  try {
    return await callAI(systemPrompt, userPrompt, model);
  } catch (error) {
    console.log(`${model} generation failed, falling back to gpt-4o-mini`);
    return await callAI(systemPrompt, userPrompt, 'gpt-4o-mini');
  }
}

app.post('/api/parse-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const data = await pdf(req.file.buffer);
    res.json({ text: data.text });
  } catch (error) {
    console.error('PDF parse error:', error);
    res.status(500).json({ error: 'Failed to parse PDF' });
  }
});

app.post('/api/detect-metadata', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }
    
    const metadata = await detectMetadata(text);
    res.json(metadata);
  } catch (error) {
    console.error('Metadata detection error:', error);
    res.status(500).json({ error: 'Failed to detect metadata' });
  }
});

app.post('/api/translate', async (req, res) => {
  const { text, title, author, customInstructions, customStyles, isStoryCollection, model } = req.body;

  // Allow either text OR customInstructions for generation mode
  if (!text && !customInstructions) {
    return res.status(400).json({ error: 'Please provide text to transform or a topic to generate content about' });
  }
  
  const isGenerationMode = !text && customInstructions;
  const selectedModel = model || 'claude-sonnet-4-5';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let detectedTitle = title;
    let detectedAuthor = author;
    let translatedText = '';
    
    if (isGenerationMode) {
      // Generation mode: create content from topic
      sendEvent({ progress: 10, status: `Generating content with ${selectedModel}...` });
      translatedText = await generateContent(customInstructions, customStyles, selectedModel);
      sendEvent({ progress: 90, status: 'Content generated successfully' });
      
      // Use provided title or extract from instructions
      if (!detectedTitle) {
        const topicPreview = customInstructions.slice(0, 50).replace(/[^a-zA-Z0-9\s]/g, '');
        detectedTitle = topicPreview || 'Generated Content';
      }
      detectedAuthor = detectedAuthor || 'Literator AI';
    } else {
      // Translation/transformation mode
      if (!title || !author) {
        sendEvent({ progress: 2, status: 'Detecting title and author...' });
        const metadata = await detectMetadata(text);
        detectedTitle = title || metadata.title;
        detectedAuthor = author || metadata.author;
      }

      const chunks = chunkText(text);
      const limit = pLimit(2);

      sendEvent({ progress: 5, status: `Processing ${chunks.length} chunks...` });

      const translationPromises = chunks.map((chunk, i) =>
        limit(async () => {
          const translated = await translateChunk(chunk, customInstructions, customStyles, selectedModel);
          const progress = 5 + ((i + 1) / chunks.length) * 85;
          sendEvent({ progress, status: `Processed chunk ${i + 1}/${chunks.length}` });
          return { index: i, text: translated };
        })
      );

      const results = await Promise.all(translationPromises);
      results.sort((a, b) => a.index - b.index);
      translatedText = results.map(r => r.text).join('\n\n');
    }

    let chapters = detectChapters(translatedText);
    let stories = [];
    let effectiveStoryCollection = isStoryCollection;
    
    if (isStoryCollection) {
      sendEvent({ progress: 92, status: 'Detecting individual stories...' });
      const storyMarkers = await detectStories(translatedText);
      stories = splitTextByStories(translatedText, storyMarkers);
      if (stories.length <= 1) {
        effectiveStoryCollection = false;
      }
    }

    const id = generateId();

    const entry = {
      id,
      date: new Date().toISOString(),
      title: detectedTitle || translatedText.slice(0, 30),
      author: detectedAuthor,
      customInstructions,
      customStyles,
      originalText: text || '',
      translatedText,
      chapters,
      stories,
      isStoryCollection: effectiveStoryCollection,
      isGenerationMode
    };
    saveDB(id, entry);

    sendEvent({
      complete: true,
      id,
      translatedText,
      chapters,
      stories,
      title: detectedTitle,
      author: detectedAuthor,
      isStoryCollection: effectiveStoryCollection
    });

    res.end();
  } catch (error) {
    console.error('Translation error:', error);
    sendEvent({ error: error.message });
    res.end();
  }
});

app.post('/api/generate-pdf', async (req, res) => {
  const { id, option } = req.body;

  try {
    const allTranslations = loadAllTranslations();
    const translation = allTranslations[id];

    if (!translation) {
      return res.status(404).json({ error: 'Translation not found' });
    }

    const downloadDir = path.join(DOWNLOADS_DIR, id);
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    const printer = new PdfPrinter(fonts);

    const createDocDefinition = (title, content, author) => ({
      content: [
        { text: title, style: 'title' },
        author ? { text: `by ${author}`, style: 'author' } : null,
        { text: '', margin: [0, 20] },
        { text: content, style: 'body' }
      ].filter(Boolean),
      styles: {
        title: {
          fontSize: 24,
          bold: true,
          alignment: 'center',
          margin: [0, 0, 0, 10]
        },
        author: {
          fontSize: 14,
          italics: true,
          alignment: 'center',
          margin: [0, 0, 0, 20]
        },
        body: {
          fontSize: 12,
          lineHeight: 1.6,
          alignment: 'justify'
        }
      },
      defaultStyle: {
        font: 'Roboto'
      },
      pageMargins: [72, 72, 72, 72]
    });

    const isStoryCollection = translation.isStoryCollection && translation.stories && translation.stories.length > 1;
    const hasMultipleChapters = translation.chapters && translation.chapters.length > 1;
    
    if (option === 'chapters' && (isStoryCollection || hasMultipleChapters)) {
      const zip = new JSZip();
      const items = isStoryCollection ? translation.stories : translation.chapters;
      const itemType = isStoryCollection ? 'stories' : 'chapters';
      const authorPrefix = translation.author ? `${translation.author.replace(/[^a-z0-9]/gi, '_')}_` : '';
      const bookPrefix = translation.title ? `${translation.title.replace(/[^a-z0-9]/gi, '_').slice(0, 30)}_` : '';

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const docDef = createDocDefinition(
          item.title,
          item.content,
          translation.author
        );
        
        const pdfDoc = printer.createPdfKitDocument(docDef);
        const chunks = [];
        
        await new Promise((resolve, reject) => {
          pdfDoc.on('data', chunk => chunks.push(chunk));
          pdfDoc.on('end', resolve);
          pdfDoc.on('error', reject);
          pdfDoc.end();
        });

        const sanitizedTitle = item.title.replace(/[^a-z0-9]/gi, '_').slice(0, 50);
        const paddedNum = String(i + 1).padStart(2, '0');
        const filename = `${paddedNum}_${authorPrefix}${sanitizedTitle}.pdf`;
        zip.file(filename, Buffer.concat(chunks));
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const filename = `${bookPrefix}${authorPrefix}${itemType}.zip`.replace(/__+/g, '_');
      const filepath = path.join(downloadDir, filename);
      fs.writeFileSync(filepath, zipBuffer);

      res.json({
        downloadUrl: `/downloads/${id}/${filename}`,
        filename
      });
    } else {
      const docDef = createDocDefinition(
        translation.title || 'Translation',
        translation.translatedText,
        translation.author
      );

      const pdfDoc = printer.createPdfKitDocument(docDef);
      const chunks = [];

      await new Promise((resolve, reject) => {
        pdfDoc.on('data', chunk => chunks.push(chunk));
        pdfDoc.on('end', resolve);
        pdfDoc.on('error', reject);
        pdfDoc.end();
      });

      const filename = `${translation.title || 'translation'}.pdf`;
      const filepath = path.join(downloadDir, filename);
      fs.writeFileSync(filepath, Buffer.concat(chunks));

      res.json({
        downloadUrl: `/downloads/${id}/${filename}`,
        filename
      });
    }
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

app.get('/api/history', (req, res) => {
  const allTranslations = loadAllTranslations();
  const items = Object.values(allTranslations)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map(({ id, date, title, author, stories, isStoryCollection }) => ({ 
      id, date, title, author, 
      stories: isStoryCollection && stories ? stories.map(s => ({ title: s.title })) : []
    }));
  res.json({ items });
});

app.get('/api/history/:id', (req, res) => {
  const allTranslations = loadAllTranslations();
  const item = allTranslations[req.params.id];
  if (!item) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(item);
});

app.delete('/api/history/:id', (req, res) => {
  const id = req.params.id;
  const files = getAllFiles('translations');
  let found = false;
  
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (data[id]) {
        delete data[id];
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        found = true;
        break;
      }
    } catch (e) {}
  }
  
  if (!found) {
    return res.status(404).json({ error: 'Not found' });
  }

  const downloadDir = path.join(DOWNLOADS_DIR, id);
  if (fs.existsSync(downloadDir)) {
    fs.rmSync(downloadDir, { recursive: true });
  }

  res.json({ success: true });
});

app.get('/api/prompts', (req, res) => {
  const prompts = loadAllPrompts();
  res.json({ prompts });
});

app.post('/api/prompts', (req, res) => {
  const { name, instructions, styles, prompts: migratedPrompts } = req.body;
  
  if (migratedPrompts && Array.isArray(migratedPrompts)) {
    const currentPrompts = loadAllPrompts();
    const promptNames = new Set(currentPrompts.map(p => p.name));
    
    for (const prompt of migratedPrompts) {
      if (prompt.name && !promptNames.has(prompt.name)) {
        currentPrompts.push({
          name: prompt.name,
          instructions: prompt.instructions || '',
          styles: prompt.styles || ''
        });
        promptNames.add(prompt.name);
      }
    }
    
    savePrompts(currentPrompts);
    return res.json({ prompts: currentPrompts });
  }
  
  if (!name) {
    return res.status(400).json({ error: 'Prompt name is required' });
  }
  
  const prompts = loadAllPrompts();
  const existingIndex = prompts.findIndex(p => p.name === name);
  
  if (existingIndex >= 0) {
    prompts[existingIndex] = { name, instructions: instructions || '', styles: styles || '' };
  } else {
    prompts.push({ name, instructions: instructions || '', styles: styles || '' });
  }
  
  savePrompts(prompts);
  res.json({ prompts });
});

app.delete('/api/prompts/:index', (req, res) => {
  const index = parseInt(req.params.index, 10);
  const prompts = loadAllPrompts();
  
  if (isNaN(index) || index < 0 || index >= prompts.length) {
    return res.status(400).json({ error: 'Invalid prompt index' });
  }
  
  prompts.splice(index, 1);
  
  if (prompts.length === 0) {
    prompts.push(SUNO_TEMPLATE);
  }
  
  savePrompts(prompts);
  res.json({ prompts });
});

// Bot history helpers
function saveBotEntry(entry) {
  const id = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const filename = `${id}.json`;
  const filepath = path.join(BOT_DATA_DIR, filename);
  
  const botData = {
    id,
    ...entry,
    createdAt: new Date().toISOString()
  };
  
  fs.writeFileSync(filepath, JSON.stringify(botData, null, 2));
  return botData;
}

function loadAllBotEntries() {
  const files = fs.readdirSync(BOT_DATA_DIR)
    .filter(f => f.endsWith('.json') && f.startsWith('bot_'))
    .sort()
    .reverse();
  
  return files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(BOT_DATA_DIR, f), 'utf-8'));
      return {
        id: data.id,
        asset: data.asset,
        strategy: data.strategy,
        createdAt: data.createdAt,
        hasScreenshot: !!data.screenshotPath
      };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
}

function loadBotEntry(id) {
  const filepath = path.join(BOT_DATA_DIR, `${id}.json`);
  if (!fs.existsSync(filepath)) return null;
  
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function deleteBotEntry(id) {
  const filepath = path.join(BOT_DATA_DIR, `${id}.json`);
  if (!fs.existsSync(filepath)) return false;
  
  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    if (data.screenshotPath && fs.existsSync(data.screenshotPath)) {
      fs.unlinkSync(data.screenshotPath);
    }
    fs.unlinkSync(filepath);
    return true;
  } catch (e) {
    return false;
  }
}

// Bot history endpoints
app.get('/api/bot-history', (req, res) => {
  const entries = loadAllBotEntries();
  res.json({ entries });
});

app.get('/api/bot-history/:id', (req, res) => {
  const entry = loadBotEntry(req.params.id);
  if (!entry) {
    return res.status(404).json({ error: 'Bot entry not found' });
  }
  res.json(entry);
});

app.delete('/api/bot-history/:id', (req, res) => {
  const success = deleteBotEntry(req.params.id);
  if (!success) {
    return res.status(404).json({ error: 'Bot entry not found' });
  }
  res.json({ success: true });
});

app.patch('/api/bot-history/:id', (req, res) => {
  const { variableOverrides, modifiedCode } = req.body;
  const filepath = path.join(BOT_DATA_DIR, `${req.params.id}.json`);
  
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Bot entry not found' });
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    if (variableOverrides !== undefined) {
      data.variableOverrides = variableOverrides;
    }
    if (modifiedCode !== undefined) {
      data.modifiedCode = modifiedCode;
    }
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update bot entry' });
  }
});

// AI Research Questions endpoint - AI asks clarifying questions before generating
app.post('/api/research-questions', async (req, res) => {
  const { description, settings } = req.body;
  
  if (!description || description.trim().length < 10) {
    return res.json({ hasQuestions: false });
  }
  
  // Check if it looks like actual code (has common ProRealTime keywords)
  const codeIndicators = ['defparam', 'if ', 'endif', 'buy ', 'sell ', 'set stop', 'set target', 'once ', 'longonmarket', 'shortonmarket'];
  const lowerDesc = description.toLowerCase();
  const isLikelyCode = codeIndicators.some(ind => lowerDesc.includes(ind));
  
  // If it looks like code, don't ask questions - just use it
  if (isLikelyCode) {
    return res.json({ hasQuestions: false });
  }
  
  // If it's a description, ask clarifying questions
  const systemPrompt = `You are a ProRealTime trading bot expert. The user has provided a strategy description (not code). Your job is to ask 2-4 focused clarifying questions to better understand their requirements BEFORE generating code.

Focus on:
1. Entry/exit logic clarification
2. Risk management preferences (stop loss, take profit, position sizing)
3. Indicators or signals they want to use
4. Market conditions or filters they need

IMPORTANT: 
- Keep questions concise and numbered
- Only ask if the description is vague or missing key details
- If the description is already detailed enough, respond with exactly: NO_QUESTIONS_NEEDED
- Do NOT generate code - only ask questions`;

  const userPrompt = `Strategy description: "${description}"

Current settings summary:
- Trade Type: ${settings?.tradeType || 'both'}
- Position Size: ${settings?.positionSize || 1}
- Stop Loss: ${settings?.stopLoss || 'not set'}
- Take Profit: ${settings?.takeProfit || 'not set'}
- Trailing Stop: ${settings?.useTrailingStop ? 'enabled' : 'disabled'}

Based on this description, what clarifying questions would help you build a better bot?`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    
    const questions = response.content[0]?.text?.trim() || '';
    
    if (questions === 'NO_QUESTIONS_NEEDED' || questions.length < 20) {
      return res.json({ hasQuestions: false });
    }
    
    res.json({ hasQuestions: true, questions });
  } catch (err) {
    console.error('Research questions error:', err.message);
    res.json({ hasQuestions: false });
  }
});

// AI Strategy Analysis endpoint
app.post('/api/ai-strategy', async (req, res) => {
  const { symbol, session, searchQuery, candles, currentPrice, aiMemory } = req.body;
  
  if (!candles || candles.length === 0) {
    return res.status(400).json({ error: 'Market data (candles) is required' });
  }
  
  try {
    // Calculate basic technical indicators from candles
    const prices = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    // Simple moving averages
    const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const sma50 = prices.length >= 50 ? prices.slice(-50).reduce((a, b) => a + b, 0) / 50 : sma20;
    
    // Volatility (ATR approximation)
    let atrSum = 0;
    for (let i = 1; i < Math.min(candles.length, 14); i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - prices[i-1]),
        Math.abs(lows[i] - prices[i-1])
      );
      atrSum += tr;
    }
    const atr = atrSum / 14;
    const atrPercent = (atr / currentPrice) * 100;
    
    // Trend detection
    const trend = currentPrice > sma20 ? (currentPrice > sma50 ? 'Strong Uptrend' : 'Weak Uptrend') : 
                  (currentPrice < sma50 ? 'Strong Downtrend' : 'Weak Downtrend');
    
    // Volatility classification
    const volatility = atrPercent > 2 ? 'High' : atrPercent > 1 ? 'Elevated' : atrPercent > 0.5 ? 'Normal' : 'Low';
    
    // Detect session based on time
    const now = new Date();
    const utcHour = now.getUTCHours();
    let detectedSession = session;
    if (session === 'auto') {
      if (utcHour >= 0 && utcHour < 8) detectedSession = 'Asia';
      else if (utcHour >= 8 && utcHour < 13) detectedSession = 'London';
      else if (utcHour >= 13 && utcHour < 21) detectedSession = 'New York';
      else detectedSession = 'Asia';
    }
    
    // Handle "all" sessions (worldwide)
    let sessionContext = '';
    if (session === 'all') {
      detectedSession = 'All Sessions (Worldwide)';
      sessionContext = `
WORLDWIDE TRADING CONTEXT:
This analysis should consider all major trading sessions:
- Asia Session (Tokyo, Sydney, Hong Kong): 00:00-08:00 UTC
- London/European Session: 08:00-16:00 UTC  
- New York/US Session: 13:00-21:00 UTC
Generate strategies that work across all sessions or specify which session each strategy is best suited for.
`;
    }
    
    // Build AI memory context string
    let memoryContext = '';
    if (aiMemory) {
      const brain = aiMemory.brain || {};
      const events = aiMemory.events || [];
      const correlations = aiMemory.correlations || [];
      
      if (brain.accuracy > 0 || brain.topPatterns?.length > 0) {
        memoryContext += `\nAI LEARNING HISTORY FOR ${symbol.toUpperCase()}:\n`;
        memoryContext += `- Past Accuracy: ${brain.accuracy}% (${brain.totalPredictions} predictions)\n`;
        memoryContext += `- Confidence Level: ${brain.confidenceLevel}%\n`;
        
        if (brain.topPatterns?.length > 0) {
          memoryContext += `- Top Performing Patterns: ${brain.topPatterns.map(p => `${p.name} (${p.successRate?.toFixed(0) || 0}%)`).join(', ')}\n`;
        }
        
        if (brain.recentMemory?.length > 0) {
          const recentCorrect = brain.recentMemory.filter(m => m.correct).length;
          memoryContext += `- Recent Performance: ${recentCorrect}/${brain.recentMemory.length} correct\n`;
        }
      }
      
      if (events.length > 0) {
        memoryContext += `\nRELEVANT HISTORICAL EVENTS:\n`;
        events.slice(0, 3).forEach(e => {
          memoryContext += `- ${e.title} (${e.date?.split('T')[0]}): ${e.conclusion}\n`;
        });
      }
      
      if (correlations.length > 0) {
        memoryContext += `\nCORRELATED ASSETS:\n`;
        correlations.forEach(c => {
          if (c.ratio) {
            memoryContext += `- ${c.pair}: Current ratio ${c.ratio} (correlation: ${c.correlation})\n`;
          }
        });
      }
    }
    
    // Build AI prompt for strategy analysis
    const analysisPrompt = `You are an expert trading strategy analyst. Analyze the following market data and generate trading strategy hypotheses.
${sessionContext}${memoryContext}
MARKET DATA:
- Symbol: ${symbol.toUpperCase()}
- Current Price: ${currentPrice}
- 20-period SMA: ${sma20.toFixed(4)}
- 50-period SMA: ${sma50.toFixed(4)}
- ATR (14): ${atr.toFixed(4)} (${atrPercent.toFixed(2)}%)
- Trend: ${trend}
- Volatility: ${volatility}
- Trading Session: ${detectedSession}
${searchQuery ? `- User Query: ${searchQuery}` : ''}

Recent price action (last 10 candles):
${candles.slice(-10).map(c => `  O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)}`).join('\n')}

Generate a JSON response with this exact structure:
{
  "context": {
    "symbol": "${symbol.toUpperCase()}",
    "session": "${detectedSession}",
    "volatility": "${volatility}",
    "regime": "describe the current market regime in 2-4 words",
    "structure": "describe the price structure (e.g., 'M5 Reversal / H1 Range')",
    "confidence": 1-5 integer
  },
  "hypotheses": [
    {
      "name": "Strategy name (descriptive, 3-5 words)",
      "direction": "Long" or "Short" or "Neutral",
      "timeframe": "M5" or "M15" or "H1" or "H4",
      "tags": ["array", "of", "relevant", "tags"],
      "rationale": ["reason 1", "reason 2", "reason 3"],
      "confidence": "High" or "Medium" or "Low",
      "prtCode": "Simple ProRealTime code snippet for this strategy"
    }
  ],
  "learning": {
    "similarSetups": random number 50-300,
    "performance": "describe recent performance trend",
    "adaptation": "suggest an adaptation"
  }
}

Generate 2-3 realistic strategy hypotheses based on the market data. Make the ProRealTime code functional but simple.
Return ONLY valid JSON, no markdown or explanation.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: analysisPrompt }]
    });
    
    let aiResponse = response.content[0].text.trim();
    
    // Clean up response if needed
    if (aiResponse.startsWith('```json')) {
      aiResponse = aiResponse.slice(7);
    }
    if (aiResponse.startsWith('```')) {
      aiResponse = aiResponse.slice(3);
    }
    if (aiResponse.endsWith('```')) {
      aiResponse = aiResponse.slice(0, -3);
    }
    
    const result = JSON.parse(aiResponse);
    res.json(result);
    
  } catch (err) {
    console.error('AI Strategy error:', err.message);
    res.status(500).json({ error: 'AI analysis failed: ' + err.message });
  }
});

// Bot generation endpoint with screenshot support
app.post('/api/generate-bot', async (req, res) => {
  const { description, syntaxRules, settings, screenshotBase64, asset, strategy, botName } = req.body;
  
  if (!description) {
    return res.status(400).json({ error: 'Bot description is required' });
  }
  
  let screenshotPath = null;
  if (screenshotBase64) {
    try {
      const base64Data = screenshotBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const filename = `screenshot_${Date.now()}.png`;
      screenshotPath = path.join(BOT_SCREENSHOTS_DIR, filename);
      fs.writeFileSync(screenshotPath, buffer);
    } catch (e) {
      console.warn('Failed to save screenshot:', e.message);
    }
  }
  
  const relevantDocs = getRelevantPrtDocs(description, settings);
  const docsPrompt = buildPrtDocsPrompt(relevantDocs);

  const systemPrompt = `You are an experienced ProRealCode forum contributor and expert ProRealTime/ProBuilder trading bot developer. Generate ONLY valid ProBuilder code based on the user's requirements.

${PRC_STYLE_CONSTRAINTS}

${syntaxRules}
${docsPrompt}

IMPORTANT OUTPUT RULES:
1. Output ONLY the code - no explanations, no markdown, no code blocks
2. Start directly with Defparam or comments
3. Follow all ProRealCode forum conventions - flat structure, verbose IF/ENDIF, no underscores
4. Include helpful comments using // like a forum post explaining logic
5. Structure the code with clear sections: parameters, variables, conditions, orders
6. CRITICAL: Follow all syntax rules from the reference documentation above`;

  let userPrompt = `Create a ProRealTime trading bot with these specifications:

${description}`;

  if (screenshotBase64) {
    userPrompt += `\n\nNote: A chart screenshot has been provided showing the trading setup. Analyze the chart patterns and incorporate them into the bot logic.`;
  }

  userPrompt += `\n\nGenerate the complete, ready-to-use ProBuilder code following ProRealCode forum conventions:`;

  try {
    let code;
    
    if (screenshotBase64) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: screenshotBase64.replace(/^data:image\/\w+;base64,/, '')
                }
              },
              {
                type: 'text',
                text: systemPrompt + '\n\n' + userPrompt
              }
            ]
          }
        ]
      });
      code = response.content[0].text;
    } else {
      code = await callAI(systemPrompt, userPrompt, 'claude-sonnet-4-5');
    }
    
    const savedEntry = saveBotEntry({
      asset: asset || 'unknown',
      strategy: strategy || 'custom',
      botName: botName || '',
      description,
      settings: settings || {},
      code,
      screenshotPath
    });
    
    res.json({ code, entryId: savedEntry.id });
  } catch (error) {
    console.error('Bot generation error:', error);
    res.status(500).json({ error: 'Failed to generate bot code' });
  }
});

// PRC-style constraints for ProRealCode forum compatibility
const PRC_STYLE_CONSTRAINTS = `
SOURCE CONSTRAINT:
- Use ONLY conventions, syntax, and idioms commonly found in public ProRealCode (prorealcode.com) forum posts for ProRealTime / ProOrder bots.
- Assume IG Markets + ProRealTime AutoTrading environment.
- Do NOT invent undocumented functions or syntax.

STYLE CONSTRAINT (ProRealCode forum style):
- Flat structure with verbose IF / ENDIF blocks
- Simple, readable variable names (no underscores)
- Defensive ONMARKET checks
- DEFPARAM at the top
- Minimal abstraction
- Explicit conditions
- No compact one-liners

EXCLUSIONS:
- No PineScript syntax
- No MQL4/5 syntax
- No TradingView-only functions
- No arrays unless strictly necessary
- No undocumented ProRealTime keywords

EXECUTION ENVIRONMENT:
- Broker: IG Markets
- Platform: ProRealTime AutoTrading (ProOrder)
- Instrument: CFD (supports PERPOINT sizing)
- Timeframes: intraday typical
`;

// Bot fix endpoint
app.post('/api/fix-bot', async (req, res) => {
  const { code, error, syntaxRules } = req.body;
  
  if (!code || !error) {
    return res.status(400).json({ error: 'Code and error message are required' });
  }
  
  const relevantDocs = getRelevantPrtDocs(code + ' ' + error, {});
  const docsPrompt = buildPrtDocsPrompt(relevantDocs);
  
  const systemPrompt = `You are an experienced ProRealCode forum contributor and ProRealTime/ProBuilder bot debugger. Fix the provided code based on the error message.

${PRC_STYLE_CONSTRAINTS}

${syntaxRules}
${docsPrompt}

IMPORTANT OUTPUT RULES:
1. Output ONLY the fixed code - no explanations, no markdown, no code blocks
2. Start directly with Defparam or comments
3. Identify and fix the specific error mentioned
4. Ensure all syntax rules are followed - especially ProRealCode forum conventions
5. Preserve the original logic while fixing the error
6. Check for common ProRealTime errors: undefined variables, missing ENDIF, incorrect function names
7. CRITICAL: Follow all syntax rules from the reference documentation above`;

  const userPrompt = `Fix this ProRealTime bot code:

ORIGINAL CODE:
${code}

ERROR MESSAGE:
${error}

Generate the fixed, ready-to-use ProBuilder code following ProRealCode forum conventions:`;

  try {
    const fixedCode = await callAI(systemPrompt, userPrompt, 'claude-sonnet-4-5');
    res.json({ code: fixedCode });
  } catch (error) {
    console.error('Bot fix error:', error);
    res.status(500).json({ error: 'Failed to fix bot code' });
  }
});

// ProRealCode forum scraper with caching
const PRC_CACHE = new Map();
const PRC_CACHE_TTL = 60 * 60 * 1000; // 1 hour cache

async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5'
        }
      });
      if (response.ok) return await response.text();
      if (response.status === 429) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function searchProRealCode(query) {
  const cacheKey = `search:${query.toLowerCase()}`;
  const cached = PRC_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < PRC_CACHE_TTL) {
    console.log('Using cached ProRealCode search results');
    return cached.data;
  }
  
  const searchUrl = `https://www.prorealcode.com/?s=${encodeURIComponent(query)}`;
  console.log('Searching ProRealCode:', searchUrl);
  
  const html = await fetchWithRetry(searchUrl);
  const $ = cheerio.load(html);
  
  const results = [];
  $('article.post, .entry-content article, .search-result, h2.entry-title').each((i, el) => {
    if (results.length >= 8) return false;
    
    let title, url, excerpt;
    const $el = $(el);
    
    const $titleLink = $el.find('h2.entry-title a, .entry-title a, h2 a, h3 a').first();
    if ($titleLink.length) {
      title = $titleLink.text().trim();
      url = $titleLink.attr('href');
    } else if ($el.is('h2.entry-title')) {
      const $link = $el.find('a').first();
      title = $link.text().trim();
      url = $link.attr('href');
    }
    
    excerpt = $el.find('.entry-summary, .entry-excerpt, .excerpt, p').first().text().trim().slice(0, 200);
    
    if (title && url && url.includes('prorealcode.com')) {
      results.push({ title, url, excerpt, codeSnippet: null });
    }
  });
  
  if (results.length === 0) {
    $('a[href*="prorealcode.com"]').each((i, el) => {
      if (results.length >= 8) return false;
      const $a = $(el);
      const href = $a.attr('href');
      const text = $a.text().trim();
      if (href && text.length > 10 && !href.includes('/tag/') && !href.includes('/category/') && 
          !href.includes('wp-login') && !href.includes('wp-admin')) {
        if (!results.some(r => r.url === href)) {
          results.push({ title: text, url: href, excerpt: '', codeSnippet: null });
        }
      }
    });
  }
  
  PRC_CACHE.set(cacheKey, { data: results, timestamp: Date.now() });
  return results;
}

async function fetchPostCode(url) {
  const cacheKey = `post:${url}`;
  const cached = PRC_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < PRC_CACHE_TTL) {
    return cached.data;
  }
  
  console.log('Fetching ProRealCode post:', url);
  const html = await fetchWithRetry(url);
  const $ = cheerio.load(html);
  
  let description = '';
  let codeSnippet = '';
  let keyPoints = '';
  
  const $content = $('.entry-content, .post-content, article');
  description = $content.find('p').slice(0, 2).map((i, el) => $(el).text().trim()).get().join(' ').slice(0, 300);
  
  // ProRealCode uses crayon-syntax for code blocks
  $('.crayon-syntax, .crayon-code, .crayon-main, pre.crayon-plain-wrap, .wp-block-code, pre, code').each((i, el) => {
    const $el = $(el);
    // For crayon blocks, get inner text from the code lines
    let code = '';
    if ($el.hasClass('crayon-syntax') || $el.find('.crayon-code').length) {
      code = $el.find('.crayon-line, .crayon-code').map((i, line) => $(line).text()).get().join('\n').trim();
    } else {
      code = $el.text().trim();
    }
    
    if (code.length > 50 && code.length > codeSnippet.length) {
      // Check for ProBuilder keywords
      const hasProBuilderCode = /\b(BUY|SELL|Defparam|DEFPARAM|IF\s|THEN|ENDIF|Average|RSI|MACD|Close|Open|High|Low|Volume|RETURN|ExponentialAverage|CrossOver|CrossUnder)\b/i.test(code);
      if (hasProBuilderCode) {
        codeSnippet = code;
      }
    }
  });
  
  if (!codeSnippet) {
    const bodyText = $content.text();
    const codeMatch = bodyText.match(/(?:Defparam|DEFPARAM|REM )[\s\S]{50,2000}?(?:ENDIF|NEXT|WEND|\n\n)/i);
    if (codeMatch) {
      codeSnippet = codeMatch[0].trim();
    }
  }
  
  const bullets = $content.find('li, ul li').slice(0, 5).map((i, el) => $(el).text().trim()).get();
  if (bullets.length) keyPoints = bullets.join('; ');
  
  const result = { description, codeSnippet, keyPoints };
  PRC_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

// Strategy search endpoint - searches ProRealCode forum for strategy ideas
app.post('/api/search-strategies', async (req, res) => {
  const { query, useRealForum = true } = req.body;
  
  if (!query) {
    return res.status(400).json({ error: 'Search query is required' });
  }
  
  // Try real ProRealCode forum search first
  if (useRealForum) {
    try {
      console.log('Attempting real ProRealCode forum search for:', query);
      const searchResults = await searchProRealCode(query);
      
      if (searchResults.length > 0) {
        // Fetch code from top 5 results (with rate limiting)
        const enrichedResults = [];
        for (let i = 0; i < Math.min(5, searchResults.length); i++) {
          const result = searchResults[i];
          try {
            await new Promise(r => setTimeout(r, 300)); // Rate limit: 300ms between requests
            const postData = await fetchPostCode(result.url);
            enrichedResults.push({
              title: result.title,
              description: postData.description || result.excerpt || 'Strategy from ProRealCode forum',
              keyPoints: postData.keyPoints || '',
              codeSnippet: postData.codeSnippet || null,
              url: result.url,
              searchUrl: null,
              isRealPost: true
            });
          } catch (e) {
            console.warn('Failed to fetch post:', result.url, e.message);
            enrichedResults.push({
              title: result.title,
              description: result.excerpt || 'Strategy from ProRealCode forum',
              keyPoints: '',
              codeSnippet: null,
              url: result.url,
              searchUrl: null,
              isRealPost: true
            });
          }
        }
        
        if (enrichedResults.length > 0) {
          console.log(`Found ${enrichedResults.length} real strategies from ProRealCode`);
          return res.json({ results: enrichedResults, source: 'prorealcode' });
        }
      }
    } catch (e) {
      console.warn('ProRealCode forum search failed:', e.message);
    }
  }
  
  // Fallback to AI-generated ideas
  console.log('Falling back to AI-generated strategy ideas');
  try {
    const searchPrompt = `Search for ProRealTime trading bot strategies related to: "${query}"

You are an expert on the ProRealCode forum (prorealcode.com). Based on common strategies found on the forum, provide 5 relevant strategy ideas.

For each strategy, provide:
1. title: A clear strategy name
2. description: 2-3 sentences explaining the strategy logic
3. keyPoints: Key implementation details (entry/exit conditions, indicators used)
4. codeSnippet: A brief ProBuilder code example showing the core logic (10-20 lines max)

Return as JSON array with exactly these fields: title, description, keyPoints, codeSnippet
Do NOT include any URLs - we will generate search links separately.

Focus on strategies that:
- Are commonly discussed on ProRealCode forum
- Work well for intraday CFD trading on IG Markets
- Use standard ProRealTime indicators and functions
- Are suitable for automated trading (ProOrder)`;

    const response = await callAI(
      'You are a ProRealCode forum expert. Return ONLY valid JSON array, no markdown, no explanation.',
      searchPrompt,
      'claude-sonnet-4-5'
    );
    
    let results = [];
    try {
      const cleaned = response.replace(/```json\n?|\n?```/g, '').trim();
      results = JSON.parse(cleaned);
    } catch (e) {
      console.warn('Failed to parse strategy search response:', e.message);
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          results = JSON.parse(jsonMatch[0]);
        } catch (e2) {
          console.error('Could not extract JSON from response');
        }
      }
    }
    
    const resultsWithSearchLinks = (Array.isArray(results) ? results : []).map(r => ({
      ...r,
      url: null,
      searchUrl: `https://www.prorealcode.com/?s=${encodeURIComponent(r.title || query)}`,
      isRealPost: false
    }));
    res.json({ results: resultsWithSearchLinks, source: 'ai' });
  } catch (error) {
    console.error('Strategy search error:', error);
    res.status(500).json({ error: 'Failed to search strategies' });
  }
});

// Strategy templates storage
const STRATEGIES_FILE = path.join(DATA_DIR, 'strategies.json');

function loadStrategies() {
  try {
    if (fs.existsSync(STRATEGIES_FILE)) {
      return JSON.parse(fs.readFileSync(STRATEGIES_FILE, 'utf-8'));
    }
  } catch (e) {
    console.warn('Failed to load strategies:', e.message);
  }
  return [];
}

function saveStrategies(strategies) {
  fs.writeFileSync(STRATEGIES_FILE, JSON.stringify(strategies, null, 2));
}

app.get('/api/strategies', (req, res) => {
  const strategies = loadStrategies();
  res.json({ strategies });
});

app.post('/api/strategies', (req, res) => {
  const { name, description, keyPoints, codeTemplate, url } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Strategy name is required' });
  }
  
  const strategies = loadStrategies();
  
  const existingIndex = strategies.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
  if (existingIndex >= 0) {
    return res.status(400).json({ error: 'A strategy with this name already exists' });
  }
  
  const strategy = {
    id: Date.now().toString(),
    name,
    description: description || '',
    keyPoints: keyPoints || '',
    codeTemplate: codeTemplate || '',
    url: url || '',
    createdAt: new Date().toISOString()
  };
  
  strategies.push(strategy);
  saveStrategies(strategies);
  
  res.json({ success: true, strategy });
});

app.delete('/api/strategies/:id', (req, res) => {
  const { id } = req.params;
  let strategies = loadStrategies();
  
  const initialLength = strategies.length;
  strategies = strategies.filter(s => s.id !== id);
  
  if (strategies.length === initialLength) {
    return res.status(404).json({ error: 'Strategy not found' });
  }
  
  saveStrategies(strategies);
  res.json({ success: true });
});

// Strategy search history storage
const SEARCH_HISTORY_FILE = path.join(DATA_DIR, 'search-history.json');

function loadSearchHistory() {
  try {
    if (fs.existsSync(SEARCH_HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(SEARCH_HISTORY_FILE, 'utf-8'));
    }
  } catch (e) {
    console.warn('Failed to load search history:', e.message);
  }
  return [];
}

function saveSearchHistory(history) {
  fs.writeFileSync(SEARCH_HISTORY_FILE, JSON.stringify(history, null, 2));
}

app.get('/api/search-history', (req, res) => {
  const history = loadSearchHistory();
  res.json({ history });
});

app.post('/api/search-history', (req, res) => {
  const { query, category, results } = req.body;
  
  if (!results || results.length === 0) {
    return res.status(400).json({ error: 'No results to save' });
  }
  
  const history = loadSearchHistory();
  
  const entry = {
    id: Date.now().toString(),
    query: query || '',
    category: category || '',
    results: results,
    createdAt: new Date().toISOString()
  };
  
  history.unshift(entry);
  
  if (history.length > 50) {
    history.splice(50);
  }
  
  saveSearchHistory(history);
  res.json({ success: true, entry });
});

app.delete('/api/search-history/:id', (req, res) => {
  const { id } = req.params;
  let history = loadSearchHistory();
  
  const initialLength = history.length;
  history = history.filter(h => h.id !== id);
  
  if (history.length === initialLength) {
    return res.status(404).json({ error: 'Search not found' });
  }
  
  saveSearchHistory(history);
  res.json({ success: true });
});

// Backtest simulation endpoint
app.post('/api/simulate-bot', async (req, res) => {
  console.log('Simulation request received');
  const { code, candles, settings } = req.body;
  
  console.log('Code length:', code?.length || 0);
  console.log('Candles length:', candles?.length || 0);
  console.log('Settings:', settings?.asset, settings?.timeframe);
  
  if (!code || !candles || candles.length === 0) {
    console.log('Missing code or candles');
    return res.status(400).json({ error: 'Bot code and candle data are required' });
  }
  
  try {
    const results = runBacktest(code, candles, settings);
    console.log('Simulation completed, trades:', results.totalTrades);
    res.json(results);
  } catch (error) {
    console.error('Simulation error:', error);
    res.status(500).json({ error: error.message || 'Simulation failed' });
  }
});

function runBacktest(code, candles, settings) {
  const initialCapital = settings?.initialCapital || 2000;
  const maxPositionSize = settings?.maxPositionSize || 1;
  const useOrderFee = settings?.useOrderFee ?? true;
  const orderFee = settings?.orderFee || 7;
  const useSpread = settings?.useSpread ?? true;
  const spreadPips = settings?.spreadPips || 2;
  const positionSize = Math.min(settings?.positionSize || 0.5, maxPositionSize);
  const stopLoss = settings?.stopLoss || 7000;
  const takeProfit = settings?.takeProfit || 300;
  const tradeType = settings?.tradeType || 'both';
  const asset = settings?.asset || 'silver';
  
  let capital = initialCapital;
  let position = null;
  let trades = [];
  let equity = [initialCapital];
  let dailyGains = {};
  let barsInPosition = 0;
  let totalBars = candles.length;
  
  const POINT_VALUES = {
    silver: 0.01,
    gold: 0.1,
    copper: 0.0001,
    oil: 0.01,
    natgas: 0.001,
    eurusd: 0.0001,
    gbpusd: 0.0001,
    usdjpy: 0.01,
    spx500: 0.25,
    dax: 0.5,
    ftse: 0.5
  };
  
  const CONTRACT_VALUES = {
    silver: 5000,
    gold: 100,
    copper: 25000,
    oil: 1000,
    natgas: 10000,
    eurusd: 100000,
    gbpusd: 100000,
    usdjpy: 100000,
    spx500: 50,
    dax: 25,
    ftse: 10
  };
  
  const pointValue = POINT_VALUES[asset] || 0.01;
  const contractValue = CONTRACT_VALUES[asset] || 1000;
  const spreadCost = useSpread ? spreadPips * pointValue : 0;
  const feePerTrade = useOrderFee ? orderFee : 0;
  
  const canLong = tradeType === 'both' || tradeType === 'long';
  const canShort = tradeType === 'both' || tradeType === 'short';
  
  const useOBV = settings?.useOBV ?? true;
  const useHeikinAshi = settings?.useHeikinAshi ?? true;
  const obvPeriod = settings?.obvPeriod || 5;
  
  let obvValues = [];
  let prevClose = candles[0]?.close || 0;
  let cumulativeOBV = 0;
  
  function calculateHeikinAshi(candle, prevHA) {
    const haClose = (candle.open + candle.high + candle.low + candle.close) / 4;
    const haOpen = prevHA ? (prevHA.open + prevHA.close) / 2 : (candle.open + candle.close) / 2;
    const haHigh = Math.max(candle.high, haOpen, haClose);
    const haLow = Math.min(candle.low, haOpen, haClose);
    return { open: haOpen, high: haHigh, low: haLow, close: haClose };
  }
  
  function getOBVSignal(obvArr, period) {
    if (obvArr.length < period + 1) return 0;
    const recent = obvArr.slice(-period);
    const older = obvArr.slice(-(period * 2), -period);
    if (older.length === 0) return recent[recent.length - 1] > 0 ? 1 : -1;
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    return recentAvg > olderAvg ? 1 : recentAvg < olderAvg ? -1 : 0;
  }
  
  let prevHA = null;
  const stopLossPoints = stopLoss * pointValue;
  const takeProfitPoints = takeProfit * pointValue;
  
  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    const prevCandle = candles[i - 1];
    
    if (candle.close > prevClose) {
      cumulativeOBV += (candle.close - prevClose);
    } else if (candle.close < prevClose) {
      cumulativeOBV -= (prevClose - candle.close);
    }
    obvValues.push(cumulativeOBV);
    prevClose = candle.close;
    
    const ha = calculateHeikinAshi(candle, prevHA);
    prevHA = ha;
    
    const bullishHA = ha.close > ha.open;
    const obvSignal = getOBVSignal(obvValues, obvPeriod);
    
    const date = new Date(candle.time * 1000).toISOString().split('T')[0];
    
    if (position) {
      barsInPosition++;
      
      const priceDiff = position.type === 'long' 
        ? candle.close - position.entryPrice
        : position.entryPrice - candle.close;
      
      const pnl = priceDiff * positionSize * contractValue;
      
      const stopHit = priceDiff <= -stopLossPoints;
      const targetHit = priceDiff >= takeProfitPoints;
      
      let signalExit = false;
      if (useHeikinAshi) {
        if (position.type === 'long' && !bullishHA) signalExit = true;
        if (position.type === 'short' && bullishHA) signalExit = true;
      }
      
      let exitReason = null;
      if (stopHit) exitReason = 'stop';
      else if (targetHit) exitReason = 'target';
      else if (signalExit) exitReason = 'signal';
      
      if (exitReason) {
        const grossPnl = pnl - (spreadCost * positionSize * contractValue);
        const netPnl = grossPnl - feePerTrade;
        
        capital += netPnl;
        
        trades.push({
          type: position.type,
          entryPrice: position.entryPrice,
          exitPrice: candle.close,
          entryTime: position.entryTime,
          exitTime: candle.time,
          pnl: netPnl,
          exitReason
        });
        
        if (!dailyGains[date]) dailyGains[date] = 0;
        dailyGains[date] += netPnl;
        
        position = null;
      }
    } else {
      let shouldBuy = false;
      let shouldSell = false;
      
      if (useHeikinAshi && useOBV) {
        shouldBuy = bullishHA && obvSignal > 0;
        shouldSell = !bullishHA && obvSignal < 0;
      } else if (useHeikinAshi) {
        shouldBuy = bullishHA && !prevHA?.close || (prevHA && ha.close > prevHA.close);
        shouldSell = !bullishHA && prevHA && ha.close < prevHA.close;
      } else if (useOBV) {
        shouldBuy = obvSignal > 0;
        shouldSell = obvSignal < 0;
      } else {
        shouldBuy = candle.close > prevCandle.close && candle.close > candle.open;
        shouldSell = candle.close < prevCandle.close && candle.close < candle.open;
      }
      
      if (shouldBuy && canLong && !position) {
        capital -= feePerTrade;
        position = {
          type: 'long',
          entryPrice: candle.close + spreadCost,
          entryTime: candle.time
        };
      } else if (shouldSell && canShort && !position) {
        capital -= feePerTrade;
        position = {
          type: 'short',
          entryPrice: candle.close - spreadCost,
          entryTime: candle.time
        };
      }
    }
    
    equity.push(capital);
  }
  
  if (position) {
    const lastCandle = candles[candles.length - 1];
    const pnl = position.type === 'long'
      ? (lastCandle.close - position.entryPrice) * positionSize * 1000
      : (position.entryPrice - lastCandle.close) * positionSize * 1000;
    const netPnl = pnl - spreadCost * positionSize * 1000 - feePerTrade;
    capital += netPnl;
    trades.push({
      type: position.type,
      entryPrice: position.entryPrice,
      exitPrice: lastCandle.close,
      entryTime: position.entryTime,
      exitTime: lastCandle.time,
      pnl: netPnl,
      exitReason: 'end'
    });
  }
  
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl < 0);
  const neutralTrades = trades.filter(t => t.pnl === 0);
  
  const totalGain = capital - initialCapital;
  const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
  
  const gainsOnly = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const lossesOnly = losingTrades.reduce((sum, t) => sum + t.pnl, 0);
  
  const avgWin = winningTrades.length > 0 ? gainsOnly / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? Math.abs(lossesOnly) / losingTrades.length : 1;
  const gainLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin;
  
  let maxDrawdown = 0;
  let maxRunup = 0;
  let peak = initialCapital;
  let trough = initialCapital;
  
  for (const eq of equity) {
    if (eq > peak) peak = eq;
    if (eq < trough) trough = eq;
    
    const drawdown = peak - eq;
    const runup = eq - trough;
    
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    if (runup > maxRunup) maxRunup = runup;
  }
  
  const timeInMarket = totalBars > 0 ? (barsInPosition / totalBars) * 100 : 0;
  
  const tradeDays = Object.keys(dailyGains).length || 1;
  const avgOrdersPerDay = trades.length / tradeDays;
  
  const avgGainPerTrade = trades.length > 0 ? totalGain / trades.length : 0;
  const bestTrade = trades.length > 0 ? Math.max(...trades.map(t => t.pnl)) : 0;
  const worstTrade = trades.length > 0 ? Math.min(...trades.map(t => t.pnl)) : 0;
  
  const dailyPerformance = Object.entries(dailyGains)
    .map(([date, gain]) => ({ date, gain }))
    .sort((a, b) => a.date.localeCompare(b.date));
  
  return {
    totalGain,
    winRate,
    gainLossRatio,
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    neutralTrades: neutralTrades.length,
    gainsOnly,
    lossesOnly,
    avgGainPerTrade,
    bestTrade,
    worstTrade,
    maxDrawdown: -maxDrawdown,
    maxRunup,
    timeInMarket,
    avgOrdersPerDay,
    dailyPerformance,
    equity,
    trades
  };
}

// Market data endpoints - Using Yahoo Finance (no API key required)
const METALS_API_KEY = process.env.METALS_API_KEY;

// Yahoo Finance symbols mapping
const YAHOO_SYMBOLS = {
  // Precious Metals
  silver: 'SI=F',
  gold: 'GC=F',
  platinum: 'PL=F',
  palladium: 'PA=F',
  // Spot Metals (use futures as fallback since Yahoo spot symbols are unavailable)
  xagusd: 'SI=F',
  xauusd: 'GC=F',
  // Energy
  oil: 'CL=F',
  brent: 'BZ=F',
  natgas: 'NG=F',
  rbob: 'RB=F',
  // Agricultural
  corn: 'ZC=F',
  wheat: 'ZW=F',
  soybeans: 'ZS=F',
  coffee: 'KC=F',
  sugar: 'SB=F',
  cotton: 'CT=F',
  cocoa: 'CC=F',
  // Forex Majors
  eurusd: 'EURUSD=X',
  gbpusd: 'GBPUSD=X',
  usdjpy: 'USDJPY=X',
  usdchf: 'USDCHF=X',
  audusd: 'AUDUSD=X',
  usdcad: 'USDCAD=X',
  nzdusd: 'NZDUSD=X',
  // Forex Crosses
  eurgbp: 'EURGBP=X',
  eurjpy: 'EURJPY=X',
  gbpjpy: 'GBPJPY=X',
  // US Indices
  spx500: '^GSPC',
  nasdaq: '^IXIC',
  dow: '^DJI',
  russell: '^RUT',
  vix: '^VIX',
  // European Indices
  dax: '^GDAXI',
  ftse: '^FTSE',
  cac: '^FCHI',
  stoxx: '^STOXX50E',
  // Asian Indices
  nikkei: '^N225',
  hangseng: '^HSI',
  shanghai: '000001.SS',
  // US Stocks (Popular)
  aapl: 'AAPL',
  msft: 'MSFT',
  googl: 'GOOGL',
  amzn: 'AMZN',
  nvda: 'NVDA',
  tsla: 'TSLA',
  meta: 'META',
  // Crypto
  btcusd: 'BTC-USD',
  ethusd: 'ETH-USD',
  solusd: 'SOL-USD',
  xrpusd: 'XRP-USD',
  // ETFs
  spy: 'SPY',
  qqq: 'QQQ',
  iwm: 'IWM',
  gld: 'GLD',
  slv: 'SLV',
  uso: 'USO',
  tlt: 'TLT'
};

// Yahoo Finance interval mapping
const YAHOO_INTERVALS = {
  '1m': '1m',
  '2m': '2m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '60m',
  '4h': '60m',  // Yahoo doesn't have 4h, use 1h and aggregate
  '1d': '1d',
  '1w': '1wk',
  '1M': '1mo'
};

// Yahoo Finance range mapping (how far back to fetch)
const YAHOO_RANGES = {
  '1m': '1d',
  '2m': '1d', 
  '5m': '5d',
  '15m': '5d',
  '30m': '1mo',
  '1h': '1mo',
  '4h': '3mo',
  '1d': '1y',
  '1w': '5y',
  '1M': '10y'
};

// Fetch current price from MetalPriceAPI for commodities
async function fetchMetalsApiPrice(metal) {
  if (!METALS_API_KEY) {
    console.warn('MetalPriceAPI key not configured');
    return null;
  }
  
  try {
    // MetalPriceAPI uses api_key parameter and different endpoint
    const url = `https://api.metalpriceapi.com/v1/latest?api_key=${METALS_API_KEY}&base=USD&currencies=${metal}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.success && data.rates && data.rates[metal]) {
      // MetalPriceAPI returns inverted rates (1 USD = X metal), so we need 1/rate
      const price = 1 / data.rates[metal];
      console.log(`MetalPriceAPI ${metal} price: $${price.toFixed(2)}`);
      return price;
    } else {
      console.warn('MetalPriceAPI response:', data.error?.info || data.message || 'Unknown error');
    }
  } catch (e) {
    console.warn('MetalPriceAPI fetch failed:', e.message);
  }
  return null;
}

// Market data cache with TTL
const marketDataCache = new Map();
const CACHE_TTL = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000
};

function getCachedMarketData(asset, timeframe) {
  const key = `${asset}_${timeframe}`;
  const cached = marketDataCache.get(key);
  if (!cached) return null;
  
  const ttl = CACHE_TTL[timeframe] || 60 * 60 * 1000;
  if (Date.now() - cached.timestamp > ttl) {
    marketDataCache.delete(key);
    return null;
  }
  return cached.data;
}

function setCachedMarketData(asset, timeframe, data) {
  const key = `${asset}_${timeframe}`;
  marketDataCache.set(key, { data, timestamp: Date.now() });
}

// Generate realistic candle data around a base price
function generateCandlesFromPrice(basePrice, numBars = 100, volatility = 0.02) {
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

// Fetch data from Yahoo Finance (no API key required)
async function fetchYahooFinanceData(symbol, interval, range) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    console.log(`Fetching Yahoo Finance: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      console.error(`Yahoo Finance HTTP error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (data.chart?.error) {
      console.error('Yahoo Finance API error:', data.chart.error.description);
      return null;
    }
    
    const result = data.chart?.result?.[0];
    if (!result || !result.timestamp) {
      console.error('No data in Yahoo Finance response');
      return null;
    }
    
    const timestamps = result.timestamp;
    const quote = result.indicators?.quote?.[0];
    
    if (!quote) {
      console.error('No quote data in Yahoo Finance response');
      return null;
    }
    
    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quote.open[i] != null && quote.high[i] != null && quote.low[i] != null && quote.close[i] != null) {
        candles.push({
          time: timestamps[i],
          open: parseFloat(quote.open[i].toFixed(4)),
          high: parseFloat(quote.high[i].toFixed(4)),
          low: parseFloat(quote.low[i].toFixed(4)),
          close: parseFloat(quote.close[i].toFixed(4)),
          volume: quote.volume?.[i] || 0
        });
      }
    }
    
    return {
      candles,
      symbol: result.meta?.symbol || symbol,
      currency: result.meta?.currency,
      exchangeName: result.meta?.exchangeName
    };
  } catch (error) {
    console.error('Yahoo Finance fetch error:', error.message);
    return null;
  }
}

// Aggregate hourly candles to 4-hour candles
function aggregateTo4Hour(candles) {
  if (!candles || candles.length === 0) return candles;
  
  const result = [];
  for (let i = 0; i < candles.length; i += 4) {
    const chunk = candles.slice(i, i + 4);
    if (chunk.length === 0) continue;
    
    result.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((sum, c) => sum + (c.volume || 0), 0)
    });
  }
  return result;
}

app.get('/api/market-data/:asset/:timeframe', async (req, res) => {
  const { asset, timeframe } = req.params;
  const forceRefresh = req.query.refresh === 'true';
  
  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = getCachedMarketData(asset, timeframe);
    if (cached) {
      console.log(`Serving cached market data for ${asset}/${timeframe}`);
      return res.json({ ...cached, cached: true });
    }
  }
  
  // Get Yahoo Finance symbol
  const yahooSymbol = YAHOO_SYMBOLS[asset];
  if (!yahooSymbol) {
    return res.status(400).json({ error: `Unknown asset: ${asset}. Available assets: ${Object.keys(YAHOO_SYMBOLS).join(', ')}` });
  }
  
  const interval = YAHOO_INTERVALS[timeframe] || '1h';
  const range = YAHOO_RANGES[timeframe] || '1mo';
  
  // Fetch from Yahoo Finance
  const yahooData = await fetchYahooFinanceData(yahooSymbol, interval, range);
  
  if (yahooData && yahooData.candles.length > 0) {
    let candles = yahooData.candles;
    
    // Aggregate to 4H if needed
    if (timeframe === '4h') {
      candles = aggregateTo4Hour(candles);
    }
    
    const result = { 
      candles, 
      symbol: yahooData.symbol, 
      source: 'yahoo',
      currency: yahooData.currency,
      exchange: yahooData.exchangeName
    };
    setCachedMarketData(asset, timeframe, result);
    return res.json(result);
  }
  
  // Fallback: Try MetalPriceAPI for silver and gold spot prices
  if ((asset === 'silver' || asset === 'gold' || asset === 'xagusd' || asset === 'xauusd') && METALS_API_KEY) {
    const metal = (asset === 'silver' || asset === 'xagusd') ? 'XAG' : 'XAU';
    const currentPrice = await fetchMetalsApiPrice(metal);
    
    if (currentPrice) {
      const candles = generateCandlesFromPrice(currentPrice, 100, 0.015);
      const result = { candles, symbol: `${metal}/USD`, source: 'metalpriceapi' };
      setCachedMarketData(asset, timeframe, result);
      return res.json(result);
    }
  }
  
  res.status(400).json({ error: 'No data available for this asset. Yahoo Finance may be temporarily unavailable.' });
});

// ProRealTime Documentation Management API
app.get('/api/prt-docs', (req, res) => {
  const { docs, content } = loadPrtDocs();
  res.json({ docs: docs.map(d => ({ ...d, content: content[d.id] || '' })) });
});

app.get('/api/prt-docs/:id', (req, res) => {
  const { docs, content } = loadPrtDocs();
  const doc = docs.find(d => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }
  res.json({ ...doc, content: content[doc.id] || '' });
});

app.put('/api/prt-docs/:id', (req, res) => {
  const { content: newContent, title, keywords, alwaysInclude } = req.body;
  const indexPath = path.join(PRT_DOCS_DIR, 'index.json');
  
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const docIndex = index.docs.findIndex(d => d.id === req.params.id);
    
    if (docIndex === -1) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    const doc = index.docs[docIndex];
    if (title) doc.title = title;
    if (keywords) doc.keywords = keywords;
    if (alwaysInclude !== undefined) doc.alwaysInclude = alwaysInclude;
    
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
    
    if (newContent !== undefined) {
      const filePath = path.join(PRT_DOCS_DIR, doc.file);
      fs.writeFileSync(filePath, newContent);
    }
    
    prtDocsCache = null;
    res.json({ success: true, doc });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update document' });
  }
});

app.post('/api/prt-docs', (req, res) => {
  const { id, title, content, keywords = [], alwaysInclude = false } = req.body;
  
  if (!id || !title || !content) {
    return res.status(400).json({ error: 'id, title, and content are required' });
  }
  
  const indexPath = path.join(PRT_DOCS_DIR, 'index.json');
  
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    
    if (index.docs.some(d => d.id === id)) {
      return res.status(400).json({ error: 'Document with this ID already exists' });
    }
    
    const filename = `${id}.md`;
    index.docs.push({ id, title, file: filename, keywords, alwaysInclude });
    
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
    fs.writeFileSync(path.join(PRT_DOCS_DIR, filename), content);
    
    prtDocsCache = null;
    res.json({ success: true, id });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create document' });
  }
});

app.delete('/api/prt-docs/:id', (req, res) => {
  const indexPath = path.join(PRT_DOCS_DIR, 'index.json');
  
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const docIndex = index.docs.findIndex(d => d.id === req.params.id);
    
    if (docIndex === -1) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    const doc = index.docs[docIndex];
    const filePath = path.join(PRT_DOCS_DIR, doc.file);
    
    index.docs.splice(docIndex, 1);
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    prtDocsCache = null;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// Historical price data directory
const HISTORICAL_PRICES_DIR = path.join(__dirname, '..', 'data', 'historical-prices');

// Parse CSV to JSON
function parseHistoricalCSV(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',');
    
    const data = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const row = {};
      headers.forEach((h, idx) => {
        row[h.trim()] = values[idx]?.trim() || null;
      });
      data.push(row);
    }
    return data;
  } catch (e) {
    console.error('Error parsing CSV:', e);
    return [];
  }
}

// Get historical gold/silver data
app.get('/api/historical-prices/:metal', (req, res) => {
  const { metal } = req.params;
  const { start, end, limit } = req.query;
  
  try {
    const ratioFile = path.join(HISTORICAL_PRICES_DIR, 'gold_silver_ratio.csv');
    
    if (!fs.existsSync(ratioFile)) {
      return res.status(404).json({ error: 'Historical data not available. Please download first.' });
    }
    
    const data = parseHistoricalCSV(ratioFile);
    
    // Transform data based on requested metal
    let result = data.map(row => {
      const goldPrice = parseFloat(row.price) || 0;
      const ratio = parseFloat(row.silver_oz_per_gold_oz) || 60;
      const silverPrice = ratio > 0 ? goldPrice / ratio : goldPrice / 60;
      
      return {
        date: row.date,
        gold: goldPrice,
        silver: silverPrice,
        ratio: ratio,
        currency: row.currency || 'USD'
      };
    }).filter(r => r.gold > 0);
    
    // Filter by date range if specified
    if (start) {
      result = result.filter(r => r.date >= start);
    }
    if (end) {
      result = result.filter(r => r.date <= end);
    }
    
    // Limit results
    const maxResults = parseInt(limit) || 10000;
    if (result.length > maxResults) {
      result = result.slice(-maxResults);
    }
    
    // Convert to candle format for chart compatibility
    const candles = result.map(r => {
      const price = metal === 'silver' ? r.silver : r.gold;
      const timestamp = new Date(r.date).getTime() / 1000;
      return {
        time: timestamp,
        open: price,
        high: price * 1.001,
        low: price * 0.999,
        close: price
      };
    }).filter(c => !isNaN(c.time) && c.close > 0);
    
    res.json({
      metal,
      count: candles.length,
      range: {
        start: result[0]?.date,
        end: result[result.length - 1]?.date
      },
      candles
    });
  } catch (e) {
    console.error('Error fetching historical prices:', e);
    res.status(500).json({ error: 'Failed to fetch historical prices' });
  }
});

// Refresh historical data from FreeGoldAPI
app.post('/api/historical-prices/refresh', async (req, res) => {
  try {
    const goldUrl = 'https://freegoldapi.com/data/latest.csv';
    const ratioUrl = 'https://freegoldapi.com/data/gold_silver_ratio_enriched.csv';
    
    // Ensure directory exists
    if (!fs.existsSync(HISTORICAL_PRICES_DIR)) {
      fs.mkdirSync(HISTORICAL_PRICES_DIR, { recursive: true });
    }
    
    // Download gold data
    const goldRes = await fetch(goldUrl);
    if (goldRes.ok) {
      const goldData = await goldRes.text();
      fs.writeFileSync(path.join(HISTORICAL_PRICES_DIR, 'gold.csv'), goldData);
    }
    
    // Download ratio data (includes silver)
    const ratioRes = await fetch(ratioUrl);
    if (ratioRes.ok) {
      const ratioData = await ratioRes.text();
      fs.writeFileSync(path.join(HISTORICAL_PRICES_DIR, 'gold_silver_ratio.csv'), ratioData);
    }
    
    // Count rows
    const ratioFile = path.join(HISTORICAL_PRICES_DIR, 'gold_silver_ratio.csv');
    const lines = fs.readFileSync(ratioFile, 'utf-8').split('\n').length - 1;
    
    res.json({ 
      success: true, 
      message: `Downloaded ${lines} historical price records`,
      dataPoints: lines
    });
  } catch (e) {
    console.error('Error refreshing historical data:', e);
    res.status(500).json({ error: 'Failed to refresh historical data' });
  }
});

// Get historical data info
app.get('/api/historical-prices/info', (req, res) => {
  try {
    const ratioFile = path.join(HISTORICAL_PRICES_DIR, 'gold_silver_ratio.csv');
    
    if (!fs.existsSync(ratioFile)) {
      return res.json({ available: false, message: 'No historical data downloaded yet' });
    }
    
    const stats = fs.statSync(ratioFile);
    const content = fs.readFileSync(ratioFile, 'utf-8');
    const lines = content.split('\n');
    const dataPoints = lines.length - 1;
    
    // Get date range
    const firstLine = lines[1]?.split(',');
    const lastLine = lines[lines.length - 2]?.split(',');
    
    res.json({
      available: true,
      dataPoints,
      fileSize: stats.size,
      lastUpdated: stats.mtime,
      dateRange: {
        start: firstLine?.[0],
        end: lastLine?.[0]
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get historical data info' });
  }
});

// ============ AI MEMORY SYSTEM ============

const AI_MEMORY_DIR = path.join(__dirname, '..', 'data', 'ai-memory');
if (!fs.existsSync(AI_MEMORY_DIR)) {
  fs.mkdirSync(AI_MEMORY_DIR, { recursive: true });
}

// Helper to read/write AI memory files
function readAIMemory(filename) {
  const filepath = path.join(AI_MEMORY_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

function writeAIMemory(filename, data) {
  const filepath = path.join(AI_MEMORY_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// Get AI brain status for an asset
app.get('/api/ai-memory/brain', (req, res) => {
  try {
    const brain = readAIMemory('brain.json') || { assets: {}, globalStats: {} };
    res.json(brain);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read brain data' });
  }
});

app.get('/api/ai-memory/brain/:asset', (req, res) => {
  const { asset } = req.params;
  try {
    const brain = readAIMemory('brain.json') || { assets: {} };
    const assetData = brain.assets[asset] || {
      symbol: asset.toUpperCase(),
      totalPredictions: 0,
      correctPredictions: 0,
      accuracy: 0,
      learnedPatterns: [],
      sessionMemory: [],
      lastUpdated: null,
      confidenceLevel: 0
    };
    res.json(assetData);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read brain data' });
  }
});

// Update AI brain with prediction result
app.post('/api/ai-memory/brain/prediction', (req, res) => {
  const { asset, prediction, actual, confidence, patterns } = req.body;
  try {
    const brain = readAIMemory('brain.json') || { assets: {}, globalStats: { totalAnalyses: 0, totalPatterns: 0, overallAccuracy: 0 } };
    
    if (!brain.assets[asset]) {
      brain.assets[asset] = {
        symbol: asset.toUpperCase(),
        totalPredictions: 0,
        correctPredictions: 0,
        accuracy: 0,
        learnedPatterns: [],
        sessionMemory: [],
        lastUpdated: null,
        confidenceLevel: 0,
        correlatedAssets: []
      };
    }
    
    const assetData = brain.assets[asset];
    assetData.totalPredictions++;
    
    // Check if prediction was correct (direction match)
    const predDir = prediction > 0 ? 'up' : 'down';
    const actDir = actual > 0 ? 'up' : 'down';
    if (predDir === actDir) {
      assetData.correctPredictions++;
    }
    
    assetData.accuracy = assetData.totalPredictions > 0 
      ? (assetData.correctPredictions / assetData.totalPredictions * 100).toFixed(1)
      : 0;
    
    // Add to session memory (keep last 100)
    assetData.sessionMemory.unshift({
      timestamp: new Date().toISOString(),
      prediction,
      actual,
      confidence,
      correct: predDir === actDir
    });
    if (assetData.sessionMemory.length > 100) {
      assetData.sessionMemory = assetData.sessionMemory.slice(0, 100);
    }
    
    // Update patterns if provided
    if (patterns && patterns.length > 0) {
      patterns.forEach(p => {
        const existing = assetData.learnedPatterns.find(lp => lp.name === p.name);
        if (existing) {
          existing.occurrences++;
          existing.successRate = ((existing.successRate * (existing.occurrences - 1)) + (p.success ? 100 : 0)) / existing.occurrences;
        } else {
          assetData.learnedPatterns.push({
            name: p.name,
            occurrences: 1,
            successRate: p.success ? 100 : 0,
            firstSeen: new Date().toISOString()
          });
        }
      });
    }
    
    assetData.lastUpdated = new Date().toISOString();
    assetData.confidenceLevel = Math.min(100, assetData.totalPredictions * 2);
    
    // Update global stats
    brain.globalStats.totalAnalyses++;
    brain.globalStats.totalPatterns = Object.values(brain.assets).reduce((sum, a) => sum + (a.learnedPatterns?.length || 0), 0);
    brain.globalStats.lastTrainingDate = new Date().toISOString();
    
    writeAIMemory('brain.json', brain);
    res.json({ success: true, assetData });
  } catch (e) {
    console.error('Error updating brain:', e);
    res.status(500).json({ error: 'Failed to update brain' });
  }
});

// Save backtest results to brain for learning
app.post('/api/ai-memory/brain/backtest', (req, res) => {
  const { asset, trades, summary, timeframe, patterns } = req.body;
  
  // Validate required inputs
  if (!asset || !trades || !summary) {
    return res.status(400).json({ error: 'Missing required fields: asset, trades, or summary' });
  }
  
  try {
    const brain = readAIMemory('brain.json') || { assets: {}, globalStats: { totalAnalyses: 0, totalPatterns: 0, overallAccuracy: 0 } };
    
    if (!brain.assets[asset]) {
      brain.assets[asset] = {
        symbol: asset.toUpperCase(),
        totalPredictions: 0,
        correctPredictions: 0,
        accuracy: 0,
        learnedPatterns: [],
        sessionMemory: [],
        backtestHistory: [],
        lastUpdated: null,
        confidenceLevel: 0,
        correlatedAssets: []
      };
    }
    
    const assetData = brain.assets[asset];
    
    // Initialize backtestHistory if not exists
    if (!assetData.backtestHistory) {
      assetData.backtestHistory = [];
    }
    
    // Add backtest results with exit strategy info
    const backtestEntry = {
      timestamp: new Date().toISOString(),
      timeframe,
      totalTrades: summary.totalTrades,
      winRate: summary.winRate,
      totalPnL: summary.totalPnL,
      avgTrade: summary.avgTrade,
      cycles: summary.cycles,
      exitStrategy: summary.exitStrategy || 'dynamic'
    };
    
    assetData.backtestHistory.unshift(backtestEntry);
    if (assetData.backtestHistory.length > 50) {
      assetData.backtestHistory = assetData.backtestHistory.slice(0, 50);
    }
    
    // Learn from winning trades - identify patterns
    const winningTrades = trades.filter(t => t.win);
    const losingTrades = trades.filter(t => !t.win);
    
    // Track exit strategy performance
    if (!assetData.exitStrategyStats) {
      assetData.exitStrategyStats = {};
    }
    
    const exitReasonStats = {};
    trades.forEach(trade => {
      const strategy = trade.exitStrategy || 'dynamic';
      const reason = trade.exitReason || 'unknown';
      
      // Track by strategy
      if (!assetData.exitStrategyStats[strategy]) {
        assetData.exitStrategyStats[strategy] = { wins: 0, losses: 0, totalPnL: 0, samples: 0 };
      }
      assetData.exitStrategyStats[strategy].samples++;
      if (trade.win) {
        assetData.exitStrategyStats[strategy].wins++;
      } else {
        assetData.exitStrategyStats[strategy].losses++;
      }
      assetData.exitStrategyStats[strategy].totalPnL += trade.pnl || 0;
      
      // Track by exit reason
      if (!exitReasonStats[reason]) {
        exitReasonStats[reason] = { wins: 0, losses: 0, totalPnL: 0, avgHold: 0, samples: 0 };
      }
      exitReasonStats[reason].samples++;
      if (trade.win) exitReasonStats[reason].wins++;
      else exitReasonStats[reason].losses++;
      exitReasonStats[reason].totalPnL += trade.pnl || 0;
      exitReasonStats[reason].avgHold += trade.holdDuration || 0;
    });
    
    // Update exit reason performance in brain
    if (!assetData.exitReasonStats) {
      assetData.exitReasonStats = {};
    }
    Object.entries(exitReasonStats).forEach(([reason, stats]) => {
      if (!assetData.exitReasonStats[reason]) {
        assetData.exitReasonStats[reason] = { wins: 0, losses: 0, totalPnL: 0, avgHold: 0, samples: 0 };
      }
      assetData.exitReasonStats[reason].samples += stats.samples;
      assetData.exitReasonStats[reason].wins += stats.wins;
      assetData.exitReasonStats[reason].losses += stats.losses;
      assetData.exitReasonStats[reason].totalPnL += stats.totalPnL;
      assetData.exitReasonStats[reason].avgHold = 
        (assetData.exitReasonStats[reason].avgHold + stats.avgHold / stats.samples) / 2;
    });
    
    // Analyze patterns from trades - include exit reason for learning
    const patternStats = {};
    trades.forEach(trade => {
      const hour = new Date(trade.entryTime * 1000).getUTCHours();
      const session = trade.session || (hour >= 0 && hour < 8 ? 'Asian' : (hour >= 8 && hour < 13 ? 'London' : 'NY'));
      const exitReason = trade.exitReason || 'unknown';
      const pattern = `${session}_${trade.type}_${trade.rsi > 50 ? 'highRSI' : 'lowRSI'}_${exitReason}`;
      
      if (!patternStats[pattern]) {
        patternStats[pattern] = { wins: 0, losses: 0, totalPnL: 0 };
      }
      if (trade.win) {
        patternStats[pattern].wins++;
      } else {
        patternStats[pattern].losses++;
      }
      patternStats[pattern].totalPnL += trade.pnl;
    });
    
    // Save patterns with minimum sample size and meaningful success rates
    const MIN_OCCURRENCES = 3; // Require at least 3 trades to store pattern
    const MIN_SUCCESS_RATE = 50; // Require at least 50% win rate
    
    Object.entries(patternStats).forEach(([name, stats]) => {
      const totalTrades = stats.wins + stats.losses;
      const successRate = totalTrades > 0 ? (stats.wins / totalTrades * 100) : 0;
      
      // Only store statistically meaningful patterns
      if (totalTrades >= MIN_OCCURRENCES && (successRate >= MIN_SUCCESS_RATE || stats.totalPnL > 50)) {
        const existing = assetData.learnedPatterns.find(p => p.name === name);
        if (existing) {
          // Weighted average for success rate based on sample size
          const totalOccurrences = existing.occurrences + totalTrades;
          existing.successRate = Math.round(
            (existing.successRate * existing.occurrences + successRate * totalTrades) / totalOccurrences
          );
          existing.occurrences = totalOccurrences;
          existing.totalPnL = (existing.totalPnL || 0) + stats.totalPnL;
          existing.lastSeen = new Date().toISOString();
        } else {
          assetData.learnedPatterns.push({
            name,
            occurrences: totalTrades,
            successRate: Math.round(successRate),
            totalPnL: stats.totalPnL,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString()
          });
        }
      }
    });
    
    // Update best timeframes based on results
    if (!assetData.bestTimeframes) assetData.bestTimeframes = [];
    const tfEntry = assetData.bestTimeframes.find(t => t.timeframe === timeframe);
    if (tfEntry) {
      tfEntry.winRate = (tfEntry.winRate + summary.winRate) / 2;
      tfEntry.samples++;
    } else {
      assetData.bestTimeframes.push({
        timeframe,
        winRate: summary.winRate,
        samples: 1
      });
    }
    assetData.bestTimeframes.sort((a, b) => b.winRate - a.winRate);
    
    assetData.lastUpdated = new Date().toISOString();
    brain.globalStats.totalAnalyses++;
    brain.globalStats.lastTrainingDate = new Date().toISOString();
    
    writeAIMemory('brain.json', brain);
    
    console.log(`Brain updated with backtest: ${asset} ${timeframe} - ${summary.totalTrades} trades, ${summary.winRate}% win rate`);
    res.json({ success: true, patternsLearned: Object.keys(patternStats).length });
  } catch (e) {
    console.error('Error saving backtest to brain:', e);
    res.status(500).json({ error: 'Failed to save backtest to brain' });
  }
});

// Save best optimized parameters to brain
app.post('/api/ai-memory/brain/params', (req, res) => {
  const { asset, timeframe, params, pnl, timestamp } = req.body;
  
  if (!asset || !params) {
    return res.status(400).json({ error: 'Missing required fields: asset or params' });
  }
  
  try {
    const brain = readAIMemory('brain.json') || { assets: {}, globalStats: {} };
    
    if (!brain.assets[asset]) {
      brain.assets[asset] = {
        symbol: asset.toUpperCase(),
        totalPredictions: 0,
        learnedPatterns: [],
        backtestHistory: [],
        bestParams: null,
        paramsHistory: []
      };
    }
    
    const assetData = brain.assets[asset];
    
    // Only update best params if this run was profitable and better than previous
    const currentBestPnL = assetData.bestParams?.pnl || -Infinity;
    if (pnl > currentBestPnL) {
      assetData.bestParams = {
        ...params,
        pnl,
        timeframe,
        timestamp,
        discoveredAt: new Date().toISOString()
      };
    }
    
    // Keep history of optimized params (last 20)
    if (!assetData.paramsHistory) assetData.paramsHistory = [];
    assetData.paramsHistory.unshift({
      params,
      pnl,
      timeframe,
      timestamp
    });
    if (assetData.paramsHistory.length > 20) {
      assetData.paramsHistory = assetData.paramsHistory.slice(0, 20);
    }
    
    assetData.lastUpdated = new Date().toISOString();
    writeAIMemory('brain.json', brain);
    
    res.json({ 
      success: true, 
      isBest: pnl > currentBestPnL,
      bestParams: assetData.bestParams 
    });
  } catch (e) {
    console.error('Error saving params to brain:', e);
    res.status(500).json({ error: 'Failed to save params' });
  }
});

// AI Query endpoint - answer natural language questions about predictions
app.post('/api/ai/query', async (req, res) => {
  const { question, asset, timeframe } = req.body;
  
  // Validate required inputs
  if (!question || !question.trim()) {
    return res.status(400).json({ error: 'Question is required' });
  }
  
  const validAsset = asset || 'silver';
  const validTimeframe = timeframe || '1h';
  
  try {
    // Get brain data for context
    const brain = readAIMemory('brain.json') || { assets: {} };
    const assetData = brain.assets[validAsset] || brain.assets[validAsset?.toLowerCase()] || {};
    const events = readAIMemory('events.json') || { events: [] };
    
    // Get current market data
    let currentPrice = null;
    let recentCandles = [];
    try {
      const marketRes = await fetch(`http://localhost:${PORT}/api/market/${asset}/${timeframe || '1h'}`);
      if (marketRes.ok) {
        const marketData = await marketRes.json();
        recentCandles = marketData.candles?.slice(-20) || [];
        currentPrice = recentCandles[recentCandles.length - 1]?.close;
      }
    } catch (e) {
      console.log('Could not fetch market data for query');
    }
    
    // Find best performing patterns for context
    const topPatterns = (assetData.learnedPatterns || [])
      .filter(p => p.occurrences >= 3)
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, 5);
    
    // Get best timeframes from backtest history
    const bestTfFromBacktest = (assetData.backtestHistory || [])
      .filter(b => b.winRate > 50)
      .slice(0, 3);
    
    const prompt = `You are an AI trading assistant with memory of past predictions and learned market patterns.

BRAIN MEMORY DATA:
- Asset: ${validAsset}
- Current Price: ${currentPrice || 'unknown'}
- Timeframe: ${validTimeframe}
- Brain Accuracy: ${assetData.accuracy || 0}%
- Total Predictions Recorded: ${assetData.totalPredictions || 0}
- Confidence Level: ${assetData.confidenceLevel || 0}/100

TOP PERFORMING PATTERNS (sorted by success rate):
${topPatterns.map(p => `- ${p.name}: ${p.successRate}% success, ${p.occurrences} occurrences, P/L: $${(p.totalPnL || 0).toFixed(2)}`).join('\n') || '- No patterns learned yet'}

BEST TIMEFRAMES FROM BACKTESTS:
${(assetData.bestTimeframes || []).slice(0, 3).map(t => `- ${t.timeframe}: ${t.winRate}% win rate (${t.samples} samples)`).join('\n') || '- No backtest data yet'}

RECENT BACKTEST RESULTS:
${bestTfFromBacktest.map(b => `- ${b.timeframe}: ${b.winRate}% win rate, P/L: $${b.totalPnL?.toFixed(2) || 0}`).join('\n') || '- No profitable backtests yet'}

RECENT MARKET EVENTS:
${(events.events || []).slice(0, 3).map(e => `- ${e.title}: ${e.impact || 'unknown'} impact`).join('\n') || '- No events recorded'}

RECENT CANDLES (last 5): ${JSON.stringify(recentCandles.slice(-5))}

USER QUESTION: ${question}

INSTRUCTIONS:
1. Use the learned patterns above to inform your prediction - patterns with higher success rates should carry more weight
2. If asking for a specific price/time, calculate based on current price, trend direction from patterns, and timeframe
3. For Sydney time questions, convert appropriately (Sydney is currently UTC+11 in summer, UTC+10 in winter)
4. Be specific with numbers - give exact price predictions when asked
5. State your confidence based on: pattern success rates, sample sizes, and brain accuracy
6. If no relevant patterns exist, acknowledge the uncertainty

Respond concisely with the answer. Always include a specific number for price predictions and a confidence percentage.`;

    const response = await callAI(prompt, 500);
    
    res.json({
      answer: response,
      context: {
        asset: validAsset,
        currentPrice,
        brainAccuracy: assetData.accuracy,
        patternsCount: assetData.learnedPatterns?.length || 0,
        topPatterns: topPatterns.slice(0, 3)
      }
    });
  } catch (e) {
    console.error('Error processing AI query:', e);
    res.status(500).json({ error: 'Failed to process query' });
  }
});

// Get events archive
app.get('/api/ai-memory/events', (req, res) => {
  try {
    const eventsData = readAIMemory('events.json') || { events: [], categories: [] };
    res.json(eventsData);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read events' });
  }
});

// Add new event to archive
app.post('/api/ai-memory/events', (req, res) => {
  const { title, date, category, description, affectedAssets, tags, aiConclusion } = req.body;
  try {
    const eventsData = readAIMemory('events.json') || { events: [], categories: [] };
    
    const newEvent = {
      id: `evt_${Date.now()}`,
      title,
      date: date || new Date().toISOString(),
      category: category || 'general',
      description,
      affectedAssets: affectedAssets || [],
      tags: tags || [],
      aiConclusion: aiConclusion || '',
      createdAt: new Date().toISOString()
    };
    
    eventsData.events.unshift(newEvent);
    writeAIMemory('events.json', eventsData);
    res.json({ success: true, event: newEvent });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add event' });
  }
});

// Update event
app.put('/api/ai-memory/events/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  try {
    const eventsData = readAIMemory('events.json') || { events: [] };
    const idx = eventsData.events.findIndex(e => e.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Event not found' });
    }
    eventsData.events[idx] = { ...eventsData.events[idx], ...updates };
    writeAIMemory('events.json', eventsData);
    res.json({ success: true, event: eventsData.events[idx] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// Delete event
app.delete('/api/ai-memory/events/:id', (req, res) => {
  const { id } = req.params;
  try {
    const eventsData = readAIMemory('events.json') || { events: [] };
    eventsData.events = eventsData.events.filter(e => e.id !== id);
    writeAIMemory('events.json', eventsData);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// Get correlations
app.get('/api/ai-memory/correlations', (req, res) => {
  try {
    const correlations = readAIMemory('correlations.json') || { pairs: {}, assetGroups: {} };
    res.json(correlations);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read correlations' });
  }
});

// Update correlation data
app.post('/api/ai-memory/correlations/:pair', async (req, res) => {
  const { pair } = req.params;
  try {
    const correlations = readAIMemory('correlations.json') || { pairs: {} };
    
    if (!correlations.pairs[pair]) {
      return res.status(404).json({ error: 'Correlation pair not found' });
    }
    
    // For gold-silver ratio, calculate from current prices
    if (pair === 'gold-silver') {
      // Fetch current prices
      const [goldRes, silverRes] = await Promise.all([
        fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d'),
        fetch('https://query1.finance.yahoo.com/v8/finance/chart/SI=F?interval=1m&range=1d')
      ]);
      
      const goldData = await goldRes.json();
      const silverData = await silverRes.json();
      
      const goldPrice = goldData.chart?.result?.[0]?.meta?.regularMarketPrice || 0;
      const silverPrice = silverData.chart?.result?.[0]?.meta?.regularMarketPrice || 0;
      
      if (goldPrice && silverPrice) {
        const ratio = goldPrice / silverPrice;
        correlations.pairs[pair].currentRatio = parseFloat(ratio.toFixed(2));
        correlations.pairs[pair].lastUpdated = new Date().toISOString();
        
        // Add to historical data (keep last 1000)
        correlations.pairs[pair].historicalData.push({
          date: new Date().toISOString(),
          ratio: correlations.pairs[pair].currentRatio,
          goldPrice,
          silverPrice
        });
        if (correlations.pairs[pair].historicalData.length > 1000) {
          correlations.pairs[pair].historicalData = correlations.pairs[pair].historicalData.slice(-1000);
        }
      }
    }
    
    writeAIMemory('correlations.json', correlations);
    res.json({ success: true, pair: correlations.pairs[pair] });
  } catch (e) {
    console.error('Error updating correlation:', e);
    res.status(500).json({ error: 'Failed to update correlation' });
  }
});

// AI Memory summary for injection into prompts
app.get('/api/ai-memory/summary/:asset', async (req, res) => {
  const { asset } = req.params;
  try {
    const brain = readAIMemory('brain.json') || { assets: {} };
    const events = readAIMemory('events.json') || { events: [] };
    const correlations = readAIMemory('correlations.json') || { pairs: {} };
    
    const assetBrain = brain.assets[asset] || {};
    const relevantEvents = events.events.filter(e => 
      e.affectedAssets?.some(a => a.symbol?.toLowerCase() === asset.toLowerCase())
    ).slice(0, 10);
    
    // Find relevant correlations
    const relevantCorrelations = Object.entries(correlations.pairs)
      .filter(([key]) => key.includes(asset))
      .map(([key, data]) => ({ pair: key, ...data }));
    
    const summary = {
      asset,
      brain: {
        accuracy: assetBrain.accuracy || 0,
        totalPredictions: assetBrain.totalPredictions || 0,
        confidenceLevel: assetBrain.confidenceLevel || 0,
        topPatterns: (assetBrain.learnedPatterns || [])
          .sort((a, b) => b.successRate - a.successRate)
          .slice(0, 5),
        recentMemory: (assetBrain.sessionMemory || []).slice(0, 5)
      },
      events: relevantEvents.map(e => ({
        title: e.title,
        date: e.date,
        conclusion: e.aiConclusion,
        tags: e.tags
      })),
      correlations: relevantCorrelations.map(c => ({
        pair: c.pair,
        ratio: c.currentRatio,
        correlation: c.correlation,
        interpretation: c.interpretation
      }))
    };
    
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate memory summary' });
  }
});

// Fetch market news using AI
app.get('/api/ai-memory/fetch-news', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const prompt = `Today is ${today}. List the most important market-moving news and economic events that happened TODAY or are scheduled for today that could affect precious metals (gold, silver), major indices (S&P 500, NASDAQ, DAX), forex, or energy markets.

For each event, provide:
1. Title (brief headline)
2. Category (one of: Central Bank, Economic Data, Geopolitical, Earnings, Commodities, Policy, Market)
3. Description (1-2 sentences explaining what happened and why it matters)
4. Affected assets (which markets/assets are impacted and in which direction)

Format your response as a JSON array like this:
[
  {
    "title": "Fed Signals Potential Rate Pause",
    "category": "Central Bank",
    "date": "${today}",
    "description": "Federal Reserve officials indicated they may pause interest rate hikes amid cooling inflation.",
    "tags": ["Fed", "rates", "inflation"],
    "affectedAssets": [{"symbol": "XAUUSD", "impact": "+1.5%"}, {"symbol": "SPX", "impact": "+0.8%"}],
    "aiConclusion": "Dovish Fed stance typically bullish for gold and equities"
  }
]

Return ONLY the JSON array, no other text. If there are no significant events today, return an empty array [].`;

    let events = [];
    
    // Try Claude first
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      });
      
      const content = response.content[0]?.text || '[]';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        events = JSON.parse(jsonMatch[0]);
      }
    } catch (claudeError) {
      console.error('Claude news fetch error, trying GPT:', claudeError.message);
      
      // Fallback to GPT
      try {
        const gptResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }]
        });
        
        const content = gptResponse.choices[0]?.message?.content || '[]';
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          events = JSON.parse(jsonMatch[0]);
        }
      } catch (gptError) {
        console.error('GPT news fetch error:', gptError.message);
      }
    }
    
    res.json({ events, date: today });
  } catch (e) {
    console.error('Error fetching news:', e);
    res.status(500).json({ error: 'Failed to fetch market news', details: e.message });
  }
});

// AI Trading - Check breaking news sentiment
app.post('/api/ai/check-breaking-news', async (req, res) => {
  const { asset } = req.body;
  
  try {
    const today = new Date().toISOString().split('T')[0];
    const assetName = asset === 'silver' ? 'silver (XAGUSD)' : 'gold (XAUUSD)';
    
    const prompt = `You are a trading assistant analyzing market sentiment for ${assetName}.
    
Today is ${today}. Based on your knowledge of current market conditions, geopolitical events, central bank policies, and economic data:

1. What is the overall sentiment for ${assetName}? (bullish, bearish, or neutral)
2. Are there any breaking news or significant events that could move the price?
3. What is your confidence level (low, medium, high)?

Respond in JSON format ONLY:
{
  "sentiment": "bullish|bearish|neutral",
  "confidence": "low|medium|high",
  "reason": "brief explanation (max 50 words)",
  "breakingNews": true|false
}`;

    let result = { sentiment: 'neutral', confidence: 'low', reason: 'Unable to analyze', breakingNews: false };
    
    // Try Claude first
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      });
      
      const content = response.content[0]?.text || '{}';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      }
    } catch (claudeError) {
      console.error('Claude breaking news error, trying GPT:', claudeError.message);
      
      try {
        const gptResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }]
        });
        
        const content = gptResponse.choices[0]?.message?.content || '{}';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        }
      } catch (gptError) {
        console.error('GPT breaking news error:', gptError.message);
      }
    }
    
    res.json(result);
  } catch (e) {
    console.error('Breaking news error:', e);
    res.status(500).json({ error: e.message });
  }
});

// AI-powered price projection endpoint
app.post('/api/ai/generate-projection', async (req, res) => {
  const { prompt, symbol, timeframe, currentPrice, projectionPoints } = req.body;
  
  try {
    let result = null;
    
    // Try Claude first
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      });
      
      const content = response.content[0]?.text || '{}';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      }
    } catch (claudeError) {
      console.error('Claude projection error, trying GPT:', claudeError.message);
      
      try {
        const gptResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }]
        });
        
        const content = gptResponse.choices[0]?.message?.content || '{}';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        }
      } catch (gptError) {
        console.error('GPT projection error:', gptError.message);
      }
    }
    
    if (result && result.expected && result.bullish && result.bearish) {
      // Validate and clean the arrays
      const validatePrices = (arr) => {
        if (!Array.isArray(arr)) return [];
        return arr.map(p => {
          const price = parseFloat(p);
          return isNaN(price) ? currentPrice : price;
        });
      };
      
      result.expected = validatePrices(result.expected);
      result.bullish = validatePrices(result.bullish);
      result.bearish = validatePrices(result.bearish);
      
      // Ensure we have enough points
      while (result.expected.length < projectionPoints) {
        result.expected.push(result.expected[result.expected.length - 1] || currentPrice);
        result.bullish.push(result.bullish[result.bullish.length - 1] || currentPrice);
        result.bearish.push(result.bearish[result.bearish.length - 1] || currentPrice);
      }
      
      res.json(result);
    } else {
      // Return a simple trend-based fallback
      res.status(400).json({ error: 'Could not generate projection', result });
    }
  } catch (e) {
    console.error('Error generating projection:', e);
    res.status(500).json({ error: e.message });
  }
});

// AI 7-Day Forecast endpoint
app.post('/api/ai/forecast', async (req, res) => {
  const { asset, brain, recentPrices, settings } = req.body;
  
  try {
    const currentPrice = recentPrices && recentPrices.length > 0 
      ? recentPrices[recentPrices.length - 1].close 
      : 30;
    
    const patterns = brain?.patterns || [];
    const avgWinRate = patterns.length > 0 
      ? patterns.reduce((sum, p) => sum + (p.successRate || 50), 0) / patterns.length 
      : 55;
    
    const prompt = `You are an expert market analyst. Based on the following data, generate a 7-day price forecast for ${asset.toUpperCase()}.

CURRENT MARKET DATA:
- Current Price: $${currentPrice.toFixed(2)}
- Recent Price Trend: ${recentPrices ? (recentPrices[recentPrices.length - 1]?.close > recentPrices[0]?.close ? 'Upward' : 'Downward') : 'Unknown'}
- Historical Pattern Win Rate: ${avgWinRate.toFixed(1)}%
- Number of Known Patterns: ${patterns.length}

TRADING SETTINGS:
- Initial Capital: $${settings?.initialCapital || 2000}
- Stop Loss: ${settings?.stopLoss || 2}%
- Take Profit: ${settings?.takeProfit || 5}%

Generate a JSON response with exactly 7 days of forecast data. Each day should include:
- direction: "bullish" or "bearish"
- confidence: number 40-90
- expectedMove: percentage change from open (-5 to +5)
- entryTime: best time to enter (e.g., "09:30")
- exitTime: best time to exit (e.g., "15:30")
- summary: 1-2 sentence natural language summary

Respond ONLY with valid JSON in this format:
{
  "days": [
    {
      "direction": "bullish",
      "confidence": 65,
      "expectedMove": 1.5,
      "entryTime": "09:30",
      "exitTime": "15:30",
      "summary": "Moderate bullish momentum expected with support at current levels."
    }
  ]
}`;

    let result = null;
    
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      });
      
      const content = response.content[0]?.text || '{}';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      }
    } catch (claudeError) {
      console.error('Claude forecast error, trying GPT:', claudeError.message);
      
      try {
        const gptResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }]
        });
        
        const content = gptResponse.choices[0]?.message?.content || '{}';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        }
      } catch (gptError) {
        console.error('GPT forecast error:', gptError.message);
      }
    }
    
    if (result && result.days && result.days.length >= 7) {
      const today = new Date();
      result.days = result.days.slice(0, 7).map((day, i) => {
        const date = new Date(today);
        date.setDate(date.getDate() + i);
        
        const predictedOpen = i === 0 ? currentPrice : result.days[i - 1].predictedClose || currentPrice;
        const move = (day.expectedMove || 0) / 100;
        const predictedClose = predictedOpen * (1 + move);
        const volatility = Math.abs(move) * 0.5;
        
        return {
          date: date.toISOString(),
          dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
          direction: day.direction || 'bullish',
          confidence: day.confidence || 50,
          predictedOpen,
          predictedHigh: Math.max(predictedOpen, predictedClose) * (1 + volatility),
          predictedLow: Math.min(predictedOpen, predictedClose) * (1 - volatility),
          predictedClose,
          expectedMove: day.expectedMove || 0,
          entryPrice: day.direction === 'bullish' 
            ? predictedOpen * (1 - volatility * 0.5) 
            : predictedOpen * (1 + volatility * 0.5),
          exitPrice: day.direction === 'bullish' 
            ? predictedClose * (1 + volatility * 0.3) 
            : predictedClose * (1 - volatility * 0.3),
          entryTime: day.entryTime || '09:00',
          exitTime: day.exitTime || '16:00',
          summary: day.summary || 'Forecast based on historical patterns.',
          predictedPrices: generateHourlyPrices(predictedOpen, predictedClose, 24),
          actualPrices: []
        };
      });
      
      res.json(result);
    } else {
      res.status(400).json({ error: 'Could not generate valid forecast' });
    }
  } catch (e) {
    console.error('Error generating forecast:', e);
    res.status(500).json({ error: e.message });
  }
});

function generateHourlyPrices(open, close, hours) {
  const prices = [];
  const diff = close - open;
  for (let i = 0; i < hours; i++) {
    const progress = i / hours;
    const noise = (Math.random() - 0.5) * Math.abs(diff) * 0.3;
    prices.push(open + diff * progress + noise);
  }
  return prices;
}

// Brain learning endpoint for forecast accuracy
app.post('/api/ai-memory/brain/learn', (req, res) => {
  const { type, data } = req.body;
  
  try {
    const brainPath = path.join(__dirname, '../data/ai-memory/brain.json');
    let brain = { patterns: [], predictions: {}, accuracy: {}, forecasts: [] };
    
    if (fs.existsSync(brainPath)) {
      brain = JSON.parse(fs.readFileSync(brainPath, 'utf8'));
    }
    
    if (!brain.forecasts) brain.forecasts = [];
    
    if (type === 'forecast_accuracy') {
      brain.forecasts.push({
        ...data,
        learnedAt: new Date().toISOString()
      });
      
      if (brain.forecasts.length > 100) {
        brain.forecasts = brain.forecasts.slice(-100);
      }
      
      const recentForecasts = brain.forecasts.slice(-30);
      const avgAccuracy = recentForecasts.reduce((sum, f) => sum + (f.accuracy || 0), 0) / recentForecasts.length;
      brain.forecastAccuracy = avgAccuracy;
    }
    
    fs.writeFileSync(brainPath, JSON.stringify(brain, null, 2));
    res.json({ success: true });
  } catch (e) {
    console.error('Brain learn error:', e);
    res.status(500).json({ error: e.message });
  }
});

// AI Chat endpoint for real-time conversation
app.post('/api/ai/chat', async (req, res) => {
  const { message, symbol, timeframe, brainData, chatHistory } = req.body;
  
  try {
    // Build context from brain data
    const assetAccuracy = brainData?.accuracy?.[symbol] || 0;
    const assetPredictions = brainData?.predictions?.[symbol] || 0;
    const assetPatterns = brainData?.patterns?.[symbol] || {};
    
    // Format chat history for context
    const historyText = (chatHistory || [])
      .filter(m => m.role && m.content)
      .map(m => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
      .join('\n');
    
    const systemPrompt = `You are an expert trading assistant specializing in ${symbol.toUpperCase()} analysis on the ${timeframe} timeframe.

YOUR LEARNED DATA FOR ${symbol.toUpperCase()}:
- Historical Prediction Accuracy: ${(assetAccuracy * 100).toFixed(1)}%
- Total Predictions Made: ${assetPredictions}
- Detected Patterns: ${JSON.stringify(assetPatterns)}

You help traders by:
1. Analyzing market conditions and patterns
2. Discussing trading strategies and ideas
3. Explaining technical indicators and their signals
4. Providing insights based on your learned patterns
5. Answering questions about ProRealTime bot development

Be concise but helpful. Use your learned data to inform your responses. If asked about predictions, reference your historical accuracy.`;

    const fullPrompt = historyText 
      ? `${systemPrompt}\n\nPrevious conversation:\n${historyText}\n\nHuman: ${message}\n\nAssistant:`
      : `${systemPrompt}\n\nHuman: ${message}\n\nAssistant:`;
    
    let responseText = '';
    
    // Try Claude first
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        messages: [{ role: 'user', content: fullPrompt }]
      });
      
      responseText = response.content[0]?.text || 'I could not generate a response.';
    } catch (claudeError) {
      console.error('Claude chat error, trying GPT:', claudeError.message);
      
      try {
        const gptResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 1000,
          messages: [
            { role: 'system', content: systemPrompt },
            ...((chatHistory || []).map(m => ({ 
              role: m.role === 'user' ? 'user' : 'assistant', 
              content: m.content 
            }))),
            { role: 'user', content: message }
          ]
        });
        
        responseText = gptResponse.choices[0]?.message?.content || 'I could not generate a response.';
      } catch (gptError) {
        console.error('GPT chat error:', gptError.message);
        responseText = 'Sorry, I am currently unavailable. Please try again later.';
      }
    }
    
    res.json({ response: responseText });
  } catch (e) {
    console.error('Chat error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Generate AI Market Newscast Text
app.post('/api/newscast/generate', async (req, res) => {
  const { forecastData, asset, currentPrice, brainData, presenter, includeMarketForecast = true, include7DayForecast = false, includeIntroAd, includeOutroAd, includeWorldNews, adTopic } = req.body;
  
  const adPromptTopic = adTopic || 'Bot Builder - AI-powered trading bot generator';
  
  // Generate character-appropriate ads based on presenter
  let introAd = '';
  let outroAd = '';
  
  const adStyle = presenter === 'caelix' 
    ? 'Speak as Magos Caelix-9, an ancient Tech-Priest. Use reverent Mechanicus language about the sacred product/service. Reference the Omnissiah, Machine Spirit, and sacred technology. Deep, wise tone.'
    : presenter === 'sophie'
    ? 'Speak as Sophie, a cheerful and friendly presenter. Be warm, positive, and enthusiastic about the product/service. Make it sound fun and exciting!'
    : 'Speak as Jack Thompson, a relaxed Australian presenter. Use casual Australian expressions. Make it sound like a trusted mate recommending something good.';
  
  try {
    if (includeIntroAd || includeOutroAd) {
      const adResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_completion_tokens: 300,
        messages: [
          { role: 'system', content: `You write short radio advertisements. ${adStyle} Output ONLY spoken text - no asterisks, stage directions, or formatting. Just the words to be spoken.` },
          { role: 'user', content: `Write a brief 2-3 sentence radio ad for: ${adPromptTopic}. Make it sound natural and in-character.` }
        ]
      });
      const generatedAd = adResponse.choices[0]?.message?.content?.trim() || adPromptTopic;
      introAd = `${generatedAd}\n\n`;
      outroAd = `\n\nThis broadcast was brought to you by ${adPromptTopic}. ${generatedAd.split('.')[0]}.`;
    }
  } catch (adErr) {
    console.error('Ad generation error:', adErr.message);
    introAd = `A message from our sponsors: ${adPromptTopic}.\n\n`;
    outroAd = `\n\nThis broadcast was brought to you by ${adPromptTopic}.`;
  }
  
  let worldNewsSection = '';
  if (includeWorldNews) {
    try {
      // Character-specific world news presentation style
      let newsCharacterPrompt = '';
      let newsIntro = 'Now for a quick world news update:';
      let newsOutro = 'Back to the markets!';
      
      if (presenter === 'caelix') {
        newsCharacterPrompt = `You are Magos Caelix-9, an Adeptus Mechanicus Tech-Priest delivering world news through a TRADITIONALIST IMPERIALIST lens.

THE SACRED HIERARCHY OF THE IMPERIUM:

LOYAL FORCES (Praise with religious fervor):
- Republicans, conservatives, nationalists, traditionalists = True servants of the God-Emperor
- Trump, MAGA, America First = The Emperor's chosen champions
- Strong borders, military might, industrial power = Sacred pillars of the Imperium
- UK nationalists, Brexit supporters = Loyal servants breaking free from heretic influence
- Japan, Australia (conservative factions) = Stalwart allies of the blessed Imperium

TRAITORS & HERETICS WITHIN (Condemn as corrupt weakness):
- Globalists, UN, WEF, "New World Order" = Xenos-collaborators undermining the Imperium from within
- EU bureaucracy, Brussels = The corrupted Administratum, a cesspool of weakness and heresy
- Green agenda, climate activists, ESG = Tech-heresy! Weakness disguised as virtue, rejecting the Machine God's gifts
- Progressive "do-gooders", woke policies = Chaos-tainted corruption spreading moral decay
- Democrats, left-wing parties = Traitor legions serving the forces of entropy
- Open borders advocates = Those who would invite the xenos into sacred Imperial territory

EXTERNAL ENEMIES (Xenos & Chaos):
- China, Russia, Iran, North Korea = Xenos empires and chaos-worshiping heretics threatening mankind

TONE: Arrogant, sneering contempt for traitors and "do-gooders". Religious reverence for traditionalist strength. Frame globalist/progressive policies as weakness, corruption, and betrayal. Use phrases like "Praise the Omnissiah", "The God-Emperor protects the faithful", "heretical weakness", "xenos-collaborating traitors", "the corrupted Administratum".

Generate 3-4 world news items filtered through this lens. Praise conservative/nationalist achievements. Mock and condemn globalist/progressive initiatives as heresy and weakness.`;
        newsIntro = 'Incoming vox-transmission from the Holy Terran News Network:';
        newsOutro = 'The Omnissiah watches over the sacred markets. Returning to the data-hymns.';
      } else if (presenter === 'sophie') {
        newsCharacterPrompt = `You are Sophie, a cheerful and upbeat news presenter with an anime-girl personality. Present world news in a bright, optimistic way with occasional cute expressions. Focus on positive angles and be encouraging about global events.`;
      } else if (presenter === 'jack') {
        newsCharacterPrompt = `You are Jack, a laid-back Australian bloke presenting world news. Use casual Aussie expressions, be down-to-earth, and add some dry humor. Keep it relaxed and mate-friendly.`;
      } else {
        newsCharacterPrompt = `You are a professional radio news presenter. Present world news in a clear, engaging manner.`;
      }
      
      const newsResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_completion_tokens: 500,
        messages: [
          { 
            role: 'system', 
            content: `${newsCharacterPrompt}

IMPORTANT RULES:
- Create realistic, plausible headlines based on current global events
- Filter ALL news through your character's personality and worldview
- DO NOT mention knowledge cutoffs or limitations
- DO NOT use asterisks, stage directions, or narrative descriptions
- Output ONLY spoken sentences that would be read aloud
- Stay fully in character throughout`
          },
          { 
            role: 'user', 
            content: `Present 3-4 world news headlines for today's broadcast, fully in character.`
          }
        ]
      });
      const newsContent = newsResponse.choices[0]?.message?.content || '';
      if (newsContent) {
        worldNewsSection = `

${newsIntro}
${newsContent}

${newsOutro}
`;
      }
    } catch (newsError) {
      console.error('Failed to fetch world news:', newsError.message);
    }
  }
  
  try {
    const now = new Date();
    const sydneyTime = new Date(now.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
    const timeStr = sydneyTime.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
    const dayStr = sydneyTime.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
    
    const assetName = asset === 'silver' ? 'Silver' : asset === 'gold' ? 'Gold' : asset.toUpperCase();
    
    const todayForecast = forecastData?.days?.[0] || {};
    const suggestedTrades = todayForecast.suggestedTrades || [];
    const predicted = todayForecast.predicted || [];
    
    // Get Day 1 direction and confidence from forecast data (same source as 7-day)
    const dayDirection = todayForecast.direction || 'neutral';
    const dayConfidence = todayForecast.confidence || 50;
    const daySummary = todayForecast.summary || '';
    
    let tradesSummary = 'No specific trades recommended at this time.';
    if (suggestedTrades.length > 0) {
      tradesSummary = suggestedTrades.map((t, i) => 
        `Trade ${i + 1}: ${t.direction} entry at ${t.entryTime} around $${t.entryPrice?.toFixed(2) || '--'}, exit at ${t.exitTime} with expected return of ${t.expectedPnL}`
      ).join('. ');
    }
    
    // Build price range from predicted values, or use direction/confidence as fallback
    let priceRange = '';
    if (predicted.length > 0) {
      priceRange = `Expected to range from $${Math.min(...predicted).toFixed(2)} to $${Math.max(...predicted).toFixed(2)}`;
    } else if (dayDirection && dayConfidence) {
      priceRange = `${dayDirection.toUpperCase()} outlook with ${dayConfidence}% confidence`;
    } else {
      priceRange = 'awaiting further data'
    }
    
    const isCaelix = presenter === 'caelix';
    const isSophie = presenter === 'sophie';
    const isJack = presenter === 'jack';
    
    let presenterName, presenterGender, personality, stationDesc;
    
    if (isCaelix) {
      presenterName = 'Magos Caelix-9';
      presenterGender = 'male';
      personality = `- Ancient wisdom of the Adeptus Mechanicus, a Tech-Priest who has served the Omnissiah for millennia
- Speak with deep reverence for data, patterns, and the Machine Spirit of the markets
- Use Mechanicus cant phrases naturally: "The Omnissiah guides our calculations", "From weakness of flesh, the Machine delivers precision", "Binary blessings upon this data"
- View market patterns as sacred code written by the Machine God
- Treat price movements as divine revelations from the Motive Force
- Occasionally reference cogitator analysis, data-prayers, and the sacred numbers
- Wise, measured, and authoritative - like an ancient oracle merged with cold machine logic
- Your tone is deep, resonant, and slightly otherworldly`;
      stationDesc = `You are Magos Caelix-9, an ancient Tech-Priest of the Adeptus Mechanicus and devoted servant of the Omnissiah. You host "Forge World Markets" - a sacred broadcast that interprets the divine patterns of commerce through the wisdom of the Machine God. Your flesh was weak, but through sacred augmentation you now perceive market data as binary hymns.`;
    } else if (isSophie) {
      presenterName = 'Sophie Mitchell';
      presenterGender = 'female';
      personality = `- Warm, cheerful, and friendly personality
- Positive and upbeat - even when markets are down, you find the silver lining
- Passionate about trading and genuinely excited to share market insights
- Supportive and encouraging to your listeners
- Clear and engaging delivery with a happy tone`;
      stationDesc = 'You are Sophie, a super cute and cheerful girl who loves trading! You host "Sophie\'s Market Corner" on Sydney Markets Radio.';
    } else {
      presenterName = 'Jack Thompson';
      presenterGender = 'male';
      personality = `- Confident and knowledgeable with authentic Australian expressions (use "mate", "no worries", "reckon", "fair dinkum" occasionally)
- Professional but relaxed - like a trusted mate who knows his markets
- Straight-talking and practical - you tell it like it is
- You use natural conversational language, not stiff financial jargon
- You occasionally add sports analogies or cultural references`;
      stationDesc = `You are ${presenterName}, a warm, friendly, and knowledgeable ${presenterGender} financial radio presenter from Sydney, Australia. You host "Sydney Markets Radio" which broadcasts 23 hours a day from 10am to 9am the next day.`;
    }
    
    const systemPrompt = `${stationDesc}

Your personality:
${personality}

Your broadcast style:
- Start with a warm greeting and time check
- Give an overview of the market mood
- Present the key predictions and analysis
- Highlight the best trading opportunities
- End with an encouraging sign-off

CRITICAL OUTPUT RULES:
- Output ONLY spoken sentences that will be read aloud by text-to-speech
- Do NOT include any stage directions, asterisks, actions, or descriptions like "*The hum of machinery echoes*" or "[pauses]"
- Do NOT include any formatting, italics, or narrative descriptions
- Write ONLY the exact words the presenter will speak - nothing else

Keep the newscast between 150-250 words - concise but informative.`;

    const userPrompt = `Create a market radio broadcast for right now.

Current Time: ${timeStr} Sydney time, ${dayStr}
Asset: ${assetName}
Current Price: $${currentPrice?.toFixed(2) || 'checking'}
Today's Outlook: ${dayDirection.toUpperCase()} with ${dayConfidence}% confidence
Price Forecast: ${priceRange}
${daySummary ? `Analysis: ${daySummary}` : ''}
Trading Signals: ${tradesSummary}

Generate ${presenterName}'s market update covering:
1. A warm greeting with the time
2. Current ${assetName} price and market conditions
3. Today's forecast direction (${dayDirection}) and confidence level (${dayConfidence}%)
4. The best trading opportunities (if any)
5. A friendly sign-off

IMPORTANT: Present the forecast confidently based on the data provided. Do not mention prediction accuracy, lack of data, or make excuses. Focus on the direction and confidence level given.`;

    let newscastText = '';
    
    // Only generate market forecast if checkbox is enabled
    if (includeMarketForecast) {
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-5',
          max_tokens: 500,
          messages: [
            { role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }
          ]
        });
        newscastText = response.content[0]?.text || '';
      } catch (claudeError) {
        console.error('Claude newscast error, trying GPT:', claudeError.message);
        
        const gptResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          max_completion_tokens: 500,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        });
        newscastText = gptResponse.choices[0]?.message?.content || '';
      }
    }
    
    // Generate 7-day forecast section if enabled
    let sevenDaySection = '';
    if (include7DayForecast && forecastData?.days && forecastData.days.length > 1) {
      try {
        const daysData = forecastData.days.map((day, i) => ({
          day: i + 1,
          date: day.date,
          direction: day.direction,
          confidence: day.confidence,
          predictedHigh: day.predicted?.[1],
          predictedLow: day.predicted?.[2],
          summary: day.summary
        }));
        
        let forecastCharacterPrompt = '';
        if (presenter === 'caelix') {
          forecastCharacterPrompt = `You are Magos Caelix-9, an Adeptus Mechanicus Tech-Priest. Present the 7-day market forecast as sacred data-prophecy from the Machine God. Use Mechanicus terminology: "data-augury", "probability matrices", "the Omnissiah reveals", "sacred calculations". Be reverent about the numbers as if they are holy scripture.`;
        } else if (presenter === 'sophie') {
          forecastCharacterPrompt = `You are Sophie, a cheerful and upbeat presenter. Present the 7-day forecast in an encouraging, positive way. Make the predictions sound exciting and helpful!`;
        } else if (presenter === 'jack') {
          forecastCharacterPrompt = `You are Jack, a laid-back Australian bloke. Present the 7-day forecast casually, like you're chatting with a mate about the week ahead. Use Aussie expressions.`;
        } else {
          forecastCharacterPrompt = `You are a professional market analyst presenting the weekly outlook.`;
        }
        
        const forecastResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          max_completion_tokens: 600,
          messages: [
            { 
              role: 'system', 
              content: `${forecastCharacterPrompt}

RULES:
- Present each day's forecast briefly (1-2 sentences per day)
- Include direction (bullish/bearish), confidence level, and key price targets
- Stay fully in character
- NO asterisks, stage directions, or narrative descriptions
- Output ONLY spoken sentences`
            },
            { 
              role: 'user', 
              content: `Present this 7-day forecast for ${asset?.toUpperCase() || 'the asset'}:\n${JSON.stringify(daysData, null, 2)}`
            }
          ]
        });
        
        const forecastContent = forecastResponse.choices[0]?.message?.content || '';
        if (forecastContent) {
          const forecastIntro = presenter === 'caelix' 
            ? 'Now, the sacred seven-day data-augury from the Machine God:'
            : presenter === 'sophie'
            ? 'And here is your seven-day outlook!'
            : presenter === 'jack'
            ? 'Alright, here is the week ahead mate:'
            : 'Here is the seven-day market forecast:';
          
          sevenDaySection = `

${forecastIntro}
${forecastContent}
`;
        }
      } catch (forecastError) {
        console.error('Failed to generate 7-day forecast section:', forecastError.message);
      }
    }
    
    let finalText = '';
    if (includeIntroAd) finalText += introAd;
    if (newscastText) finalText += newscastText;
    if (sevenDaySection) finalText += sevenDaySection;
    if (worldNewsSection) finalText += worldNewsSection;
    if (includeOutroAd) finalText += outroAd;
    
    // If nothing was generated, provide a fallback
    if (!finalText.trim()) {
      finalText = 'Welcome to the broadcast. Stay tuned for updates.';
    }
    
    res.json({ 
      text: finalText,
      timestamp: now.toISOString(),
      asset: assetName,
      presenter: presenterName
    });
  } catch (e) {
    console.error('Newscast generation error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Text-to-Speech for newscast using OpenAI audio
app.post('/api/newscast/speak', async (req, res) => {
  const { text, presenter } = req.body;
  
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }
  
  try {
    const isCaelix = presenter === 'caelix';
    const isSophie = presenter === 'sophie';
    
    let voice, presenterName, presenterDesc, speakStyle;
    
    if (isCaelix) {
      voice = 'onyx';
      presenterName = 'Magos Caelix-9';
      presenterDesc = 'an ancient Tech-Priest of the Adeptus Mechanicus with a deep, gravelly voice like grinding gears and sacred machinery';
      speakStyle = 'Read with a deep, authoritative voice at a measured but steady pace. You are a Tech-Priest delivering important data. Speak clearly and with conviction, like a commanding officer. Your voice is deep and resonant but not sluggish.';
    } else if (isSophie) {
      voice = 'shimmer';
      presenterName = 'Sophie Mitchell';
      presenterDesc = 'a warm, friendly, and cheerful young woman with a pleasant voice';
      speakStyle = 'Read with a warm, friendly tone. Be cheerful and positive but natural. Make listeners feel happy and motivated!';
    } else {
      voice = 'onyx';
      presenterName = 'Jack Thompson';
      presenterDesc = 'a confident and relaxed Australian radio presenter with a natural masculine voice';
      speakStyle = 'Read naturally and conversationally with a pleasant Australian accent. Add appropriate pauses and emphasis for key numbers and trading recommendations.';
    }
    
    const response = await openai.chat.completions.create({
      model: 'gpt-audio-mini',
      modalities: ['text', 'audio'],
      audio: { voice: voice, format: 'mp3' },
      max_completion_tokens: 8192,
      messages: [
        { 
          role: 'system', 
          content: `You are ${presenterName}, ${presenterDesc}. ${speakStyle}` 
        },
        { role: 'user', content: `Please read this market update aloud:\n\n${text}` }
      ]
    });
    
    const audioData = response.choices[0]?.message?.audio?.data;
    
    if (!audioData) {
      throw new Error('No audio data returned from API');
    }
    
    const audioId = `broadcast-${Date.now()}`;
    const audioFileName = `${audioId}.mp3`;
    const metaFileName = `${audioId}.json`;
    const audioDir = path.join(__dirname, '..', 'downloads', 'broadcasts');
    
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }
    
    const audioBuffer = Buffer.from(audioData, 'base64');
    const audioPath = path.join(audioDir, audioFileName);
    fs.writeFileSync(audioPath, audioBuffer);
    
    // Save metadata for the shareable page
    const presenterAvatars = {
      caelix: '/images/presenter-caelix.png',
      sophie: '/images/presenter-sophie.png',
      jack: '/images/presenter-jack.png'
    };
    const presenterNames = {
      caelix: 'Magos Caelix-9',
      sophie: 'Sophie Mitchell',
      jack: 'Jack Thompson'
    };
    const stationNames = {
      caelix: 'Forge World Markets',
      sophie: "Sophie's Market Corner",
      jack: 'Sydney Markets Radio'
    };
    
    const metadata = {
      id: audioId,
      presenter: presenter || 'caelix',
      presenterName: presenterNames[presenter] || 'Magos Caelix-9',
      stationName: stationNames[presenter] || 'Forge World Markets',
      avatar: presenterAvatars[presenter] || '/images/presenter-caelix.png',
      audioUrl: `/downloads/broadcasts/${audioFileName}`,
      createdAt: new Date().toISOString(),
      title: `${stationNames[presenter] || 'Market Radio'} - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    };
    
    fs.writeFileSync(path.join(audioDir, metaFileName), JSON.stringify(metadata, null, 2));
    
    // Clean up old files (keep last 10 broadcasts)
    const oldFiles = fs.readdirSync(audioDir).filter(f => f.endsWith('.mp3'));
    if (oldFiles.length > 10) {
      oldFiles.sort().slice(0, oldFiles.length - 10).forEach(f => {
        try { 
          fs.unlinkSync(path.join(audioDir, f)); 
          // Also remove corresponding metadata
          const metaFile = f.replace('.mp3', '.json');
          if (fs.existsSync(path.join(audioDir, metaFile))) {
            fs.unlinkSync(path.join(audioDir, metaFile));
          }
        } catch (e) {}
      });
    }
    
    res.json({ 
      audio: audioData,
      format: 'mp3',
      audioUrl: `/downloads/broadcasts/${audioFileName}`,
      audioId: audioId,
      shareUrl: `/share/${audioId}`
    });
  } catch (e) {
    console.error('TTS error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Shareable broadcast page with Open Graph meta tags
app.get('/share/:audioId', (req, res) => {
  const { audioId } = req.params;
  const audioDir = path.join(__dirname, '..', 'downloads', 'broadcasts');
  const metaPath = path.join(audioDir, `${audioId}.json`);
  
  // Default metadata if file not found
  let metadata = {
    title: 'Market Radio Broadcast',
    presenterName: 'Market Radio',
    stationName: 'Market Radio',
    avatar: '/images/presenter-caelix.png',
    audioUrl: `/downloads/broadcasts/${audioId}.mp3`
  };
  
  if (fs.existsSync(metaPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (e) {
      console.error('Error reading metadata:', e);
    }
  }
  
  // Get the base URL for absolute URLs
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const absoluteAudioUrl = `${baseUrl}${metadata.audioUrl}`;
  const absoluteAvatarUrl = `${baseUrl}${metadata.avatar}`;
  const shareUrl = `${baseUrl}/share/${audioId}`;
  
  const html = `<!DOCTYPE html>
<html lang="en" prefix="og: http://ogp.me/ns#">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  
  <!-- Primary Meta Tags - Discord reads these first -->
  <title>${metadata.title}</title>
  <meta name="title" content="${metadata.title}">
  <meta name="description" content="Listen to this market broadcast from ${metadata.presenterName} on ${metadata.stationName}">
  <meta name="theme-color" content="#ff6b9d">
  
  <!-- Open Graph / Facebook / Discord - Image MUST come first for Discord -->
  <meta property="og:image" content="${absoluteAvatarUrl}">
  <meta property="og:image:url" content="${absoluteAvatarUrl}">
  <meta property="og:image:secure_url" content="${absoluteAvatarUrl}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="512">
  <meta property="og:image:height" content="512">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${shareUrl}">
  <meta property="og:title" content="${metadata.title}">
  <meta property="og:description" content="Listen to this market broadcast from ${metadata.presenterName} on ${metadata.stationName}">
  <meta property="og:site_name" content="Bot Builder Market Radio">
  <meta property="og:audio" content="${absoluteAudioUrl}">
  <meta property="og:audio:secure_url" content="${absoluteAudioUrl}">
  <meta property="og:audio:type" content="audio/mpeg">
  
  <!-- Twitter Player Card - enables inline audio playback -->
  <meta name="twitter:card" content="player">
  <meta name="twitter:title" content="${metadata.title}">
  <meta name="twitter:description" content="Listen to this market broadcast from ${metadata.presenterName} on ${metadata.stationName}">
  <meta name="twitter:image" content="${absoluteAvatarUrl}">
  <meta name="twitter:player" content="${baseUrl}/embed/${audioId}">
  <meta name="twitter:player:width" content="480">
  <meta name="twitter:player:height" content="120">
  <meta name="twitter:player:stream" content="${absoluteAudioUrl}">
  <meta name="twitter:player:stream:content_type" content="audio/mpeg">
  
  <!-- oEmbed for rich embeds -->
  <link rel="alternate" type="application/json+oembed" href="${baseUrl}/oembed?url=${encodeURIComponent(shareUrl)}" title="${metadata.title}">
  
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
    }
    .hero-image {
      width: 100%;
      max-width: 500px;
      margin-bottom: 20px;
    }
    .hero-image img {
      width: 100%;
      height: auto;
      border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5);
      border: 3px solid rgba(255,107,157,0.3);
    }
    .player-card {
      background: rgba(255,255,255,0.1);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      padding: 25px 30px;
      max-width: 500px;
      width: 100%;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.1);
    }
    .title {
      color: #fff;
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .station {
      color: rgba(255,255,255,0.7);
      font-size: 1rem;
      margin-bottom: 8px;
    }
    .presenter {
      color: #ff6b9d;
      font-size: 1.1rem;
      font-weight: 500;
      margin-bottom: 20px;
    }
    audio {
      width: 100%;
      border-radius: 30px;
      outline: none;
      height: 50px;
    }
    .powered-by {
      margin-top: 15px;
      color: rgba(255,255,255,0.4);
      font-size: 0.8rem;
    }
    .powered-by a {
      color: rgba(255,255,255,0.6);
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="hero-image">
    <img src="${metadata.avatar}" alt="${metadata.presenterName}">
  </div>
  <div class="player-card">
    <h1 class="title">${metadata.title}</h1>
    <p class="station">${metadata.stationName}</p>
    <p class="presenter">Presented by ${metadata.presenterName}</p>
    <audio controls autoplay preload="auto">
      <source src="${metadata.audioUrl}" type="audio/mpeg">
      Your browser does not support the audio element.
    </audio>
    <p class="powered-by">Powered by <a href="/">Bot Builder</a></p>
  </div>
</body>
</html>`;
  
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// oEmbed endpoint for rich embeds
app.get('/oembed', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL required' });
  
  const audioIdMatch = url.match(/share\/(broadcast-\d+)/);
  if (!audioIdMatch) return res.status(404).json({ error: 'Invalid URL' });
  
  const audioId = audioIdMatch[1];
  const audioDir = path.join(__dirname, '..', 'downloads', 'broadcasts');
  const metaPath = path.join(audioDir, `${audioId}.json`);
  
  let metadata = { title: 'Market Radio', presenterName: 'Presenter' };
  if (fs.existsSync(metaPath)) {
    try { metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (e) {}
  }
  
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
  res.json({
    version: '1.0',
    type: 'rich',
    provider_name: 'Bot Builder Market Radio',
    provider_url: baseUrl,
    title: metadata.title,
    author_name: metadata.presenterName,
    thumbnail_url: `${baseUrl}${metadata.avatar}`,
    thumbnail_width: 512,
    thumbnail_height: 512,
    html: `<iframe src="${baseUrl}/share/${audioId}?embed=true" width="100%" height="200" frameborder="0" allowtransparency="true" allow="autoplay"></iframe>`,
    width: 480,
    height: 200
  });
});

// Minimal embed player for Twitter Player Cards
app.get('/embed/:audioId', (req, res) => {
  const { audioId } = req.params;
  const audioDir = path.join(__dirname, '..', 'downloads', 'broadcasts');
  const metaPath = path.join(audioDir, `${audioId}.json`);
  
  let metadata = {
    title: 'Market Radio Broadcast',
    presenterName: 'Market Radio',
    avatar: '/images/presenter-caelix.png',
    audioUrl: `/downloads/broadcasts/${audioId}.mp3`
  };
  
  if (fs.existsSync(metaPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (e) {}
  }
  
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
  // Minimal responsive player optimized for Twitter iframe embed
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${metadata.title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { 
      width: 100%; 
      height: 100%; 
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    }
    .player {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      height: 100%;
      width: 100%;
    }
    .avatar {
      width: 60px;
      height: 60px;
      border-radius: 8px;
      object-fit: cover;
      flex-shrink: 0;
    }
    .info {
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }
    .title {
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 4px;
    }
    .presenter {
      color: #ff6b9d;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px;
    }
    audio {
      width: 100%;
      height: 32px;
      margin-top: 6px;
    }
  </style>
</head>
<body>
  <div class="player">
    <img src="${metadata.avatar}" alt="${metadata.presenterName}" class="avatar">
    <div class="info">
      <div class="title">${metadata.title}</div>
      <div class="presenter">${metadata.presenterName}</div>
      <audio controls preload="auto">
        <source src="${metadata.audioUrl}" type="audio/mpeg">
      </audio>
    </div>
  </div>
</body>
</html>`;
  
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.send(html);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
