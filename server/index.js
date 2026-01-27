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
  const { symbol, session, searchQuery, candles, currentPrice } = req.body;
  
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
    
    // Build AI prompt for strategy analysis
    const analysisPrompt = `You are an expert trading strategy analyst. Analyze the following market data and generate trading strategy hypotheses.

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
      model: 'claude-sonnet-4-20250514',
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
  // Spot Metals (alternative)
  xagusd: 'XAGUSD=X',
  xauusd: 'XAUUSD=X',
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
