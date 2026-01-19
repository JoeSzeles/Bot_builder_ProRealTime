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
const MAX_ENTRIES_PER_FILE = 10;

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

// Bot generation endpoint with screenshot support
app.post('/api/generate-bot', async (req, res) => {
  const { description, syntaxRules, settings, screenshotBase64, asset, strategy } = req.body;
  
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
  
  const systemPrompt = `You are an expert ProRealTime/ProBuilder trading bot developer. Generate ONLY valid ProBuilder code based on the user's requirements.

${syntaxRules}

IMPORTANT OUTPUT RULES:
1. Output ONLY the code - no explanations, no markdown, no code blocks
2. Start directly with Defparam or comments
3. Follow all syntax rules strictly - especially NO underscores in variable names
4. Include helpful comments using //
5. Structure the code properly with clear sections`;

  let userPrompt = `Create a ProRealTime trading bot with these specifications:

${description}`;

  if (screenshotBase64) {
    userPrompt += `\n\nNote: A chart screenshot has been provided showing the trading setup. Analyze the chart patterns and incorporate them into the bot logic.`;
  }

  userPrompt += `\n\nGenerate the complete, ready-to-use ProBuilder code now:`;

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

// Bot fix endpoint
app.post('/api/fix-bot', async (req, res) => {
  const { code, error, syntaxRules } = req.body;
  
  if (!code || !error) {
    return res.status(400).json({ error: 'Code and error message are required' });
  }
  
  const systemPrompt = `You are an expert ProRealTime/ProBuilder trading bot developer and debugger. Fix the provided code based on the error message.

${syntaxRules}

IMPORTANT OUTPUT RULES:
1. Output ONLY the fixed code - no explanations, no markdown, no code blocks
2. Start directly with Defparam or comments
3. Identify and fix the specific error mentioned
4. Ensure all syntax rules are followed
5. Preserve the original logic while fixing the error`;

  const userPrompt = `Fix this ProRealTime bot code:

ORIGINAL CODE:
${code}

ERROR MESSAGE:
${error}

Generate the fixed, ready-to-use ProBuilder code now:`;

  try {
    const fixedCode = await callAI(systemPrompt, userPrompt, 'claude-sonnet-4-5');
    res.json({ code: fixedCode });
  } catch (error) {
    console.error('Bot fix error:', error);
    res.status(500).json({ error: 'Failed to fix bot code' });
  }
});

// Backtest simulation endpoint
app.post('/api/simulate-bot', async (req, res) => {
  const { code, candles, settings } = req.body;
  
  if (!code || !candles || candles.length === 0) {
    return res.status(400).json({ error: 'Bot code and candle data are required' });
  }
  
  try {
    const results = runBacktest(code, candles, settings);
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
    equity
  };
}

// Market data endpoints
const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY;
const METALS_API_KEY = process.env.METALS_API_KEY;

const ASSET_SYMBOLS = {
  silver: 'XAG/USD',
  gold: 'XAU/USD', 
  copper: 'HG',
  oil: 'CL',
  natgas: 'NG',
  eurusd: 'EUR/USD',
  gbpusd: 'GBP/USD',
  usdjpy: 'USD/JPY',
  spx500: 'SPX',
  dax: 'DAX',
  ftse: 'FTSE'
};

const TIMEFRAME_MAP = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1h': '1h',
  '4h': '4h',
  '1d': '1day'
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

app.get('/api/market-data/:asset/:timeframe', async (req, res) => {
  const { asset, timeframe } = req.params;
  
  // Try MetalPriceAPI for silver and gold
  if (asset === 'silver' || asset === 'gold') {
    const metal = asset === 'silver' ? 'XAG' : 'XAU';
    const currentPrice = await fetchMetalsApiPrice(metal);
    
    if (currentPrice) {
      const candles = generateCandlesFromPrice(currentPrice, 100, 0.015);
      return res.json({ candles, symbol: `${metal}/USD`, source: 'metalpriceapi' });
    }
  }
  
  // Try Twelve Data for forex
  if (TWELVEDATA_API_KEY) {
    const symbol = ASSET_SYMBOLS[asset];
    if (!symbol) {
      return res.status(400).json({ error: 'Unknown asset' });
    }
    
    const interval = TIMEFRAME_MAP[timeframe] || '1h';
    
    try {
      const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=100&apikey=${TWELVEDATA_API_KEY}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.status === 'error') {
        console.error('Twelve Data error:', data.message);
        return res.status(400).json({ error: data.message || 'Failed to fetch data' });
      }
      
      if (data.values && Array.isArray(data.values)) {
        const candles = data.values.reverse().map(bar => ({
          time: Math.floor(new Date(bar.datetime).getTime() / 1000),
          open: parseFloat(bar.open),
          high: parseFloat(bar.high),
          low: parseFloat(bar.low),
          close: parseFloat(bar.close)
        }));
        
        return res.json({ candles, symbol: data.meta?.symbol || symbol, source: 'twelvedata' });
      }
    } catch (error) {
      console.error('Twelve Data fetch error:', error);
    }
  }
  
  res.status(400).json({ error: 'No data available for this asset' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
