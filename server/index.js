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
const MAX_ENTRIES_PER_FILE = 10;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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

function savePrompts(prompts) {
  const { file, prompts: currentPrompts } = loadActivePrompts();
  
  // Check if we need to rotate
  if (currentPrompts.length >= MAX_ENTRIES_PER_FILE) {
    const newFile = path.join(DATA_DIR, `prompts_${Date.now()}.json`);
    fs.writeFileSync(newFile, JSON.stringify({ prompts }, null, 2));
  } else {
    fs.writeFileSync(file, JSON.stringify({ prompts }, null, 2));
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
