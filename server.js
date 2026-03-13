require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const expressWs = require('express-ws');

const app = express();
expressWs(app);

// Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Upload Ordner sicherstellen
const uploadDir = path.join(__dirname, process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// Multer Konfiguration für MP3 Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.ogg', '.m4a'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Nur Audio-Dateien erlaubt (MP3, WAV, OGG, M4A)'));
    }
  }
});

// WebSocket für Multiperson-Locking
const locks = {}; // { languageId: { userId, timestamp } }
const clients = new Set();

app.ws('/ws', (ws, req) => {
  const userId = Math.random().toString(36).substr(2, 9);
  ws.userId = userId;
  clients.add(ws);

  ws.send(JSON.stringify({ type: 'connected', userId, locks }));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'lock') {
        // Check if language is already locked by someone else
        if (locks[data.langId] && locks[data.langId].userId !== userId) {
          ws.send(JSON.stringify({ type: 'lock_denied', langId: data.langId }));
          return;
        }
        locks[data.langId] = { userId, timestamp: Date.now() };
        broadcast({ type: 'lock_update', locks }, ws);
        ws.send(JSON.stringify({ type: 'lock_granted', langId: data.langId }));
      } else if (data.type === 'unlock') {
        if (locks[data.langId] && locks[data.langId].userId === userId) {
          delete locks[data.langId];
          broadcast({ type: 'lock_update', locks });
        }
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    clients.delete(ws);
    // Release all locks held by this user
    let changed = false;
    for (const langId in locks) {
      if (locks[langId].userId === userId) {
        delete locks[langId];
        changed = true;
      }
    }
    if (changed) broadcast({ type: 'lock_update', locks });
  });
});

function broadcast(data, exclude = null) {
  const msg = JSON.stringify(data);
  clients.forEach(client => {
    if (client !== exclude && client.readyState === 1) {
      client.send(msg);
    }
  });
}

// ==================== SPRACHEN API ====================

app.get('/api/languages', async (req, res) => {
  const { data, error } = await supabase
    .from('languages')
    .select('*')
    .order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/languages', async (req, res) => {
  const { name, code, flag, info, pronunciation_guide } = req.body;
  const { data, error } = await supabase
    .from('languages')
    .insert([{ name, code, flag, info, pronunciation_guide }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'language_added', language: data });
  res.json(data);
});

app.put('/api/languages/:id', async (req, res) => {
  const { id } = req.params;
  const { name, code, flag, info, pronunciation_guide } = req.body;
  const { data, error } = await supabase
    .from('languages')
    .update({ name, code, flag, info, pronunciation_guide })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'language_updated', language: data });
  res.json(data);
});

app.delete('/api/languages/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('languages').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'language_deleted', languageId: id });
  res.json({ success: true });
});

// ==================== SEITEN API ====================

app.get('/api/languages/:langId/pages', async (req, res) => {
  const { langId } = req.params;
  const { type } = req.query; // 'word' or 'sentence'
  let query = supabase.from('pages').select('*').eq('language_id', langId).order('order_index');
  if (type) query = query.eq('type', type);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/languages/:langId/pages', async (req, res) => {
  const { langId } = req.params;
  const { name, type, order_index, page_audio_url } = req.body;
  const { data, error } = await supabase
    .from('pages')
    .insert([{ language_id: langId, name, type: type || 'word', order_index: order_index || 0, page_audio_url }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'page_added', page: data });
  res.json(data);
});

app.put('/api/pages/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const { data, error } = await supabase
    .from('pages')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'page_updated', page: data });
  res.json(data);
});

app.delete('/api/pages/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('pages').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'page_deleted', pageId: id });
  res.json({ success: true });
});

// Page Audio Upload
app.post('/api/pages/:id/audio', upload.single('audio'), async (req, res) => {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });
  const audioUrl = `/uploads/${req.file.filename}`;
  const { data, error } = await supabase
    .from('pages')
    .update({ page_audio_url: audioUrl })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ url: audioUrl, page: data });
});

// ==================== VOKABELN API ====================

app.get('/api/pages/:pageId/vocabs', async (req, res) => {
  const { pageId } = req.params;
  const { data, error } = await supabase
    .from('vocabs')
    .select('*')
    .eq('page_id', pageId)
    .order('order_index');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/languages/:langId/vocabs/search', async (req, res) => {
  const { langId } = req.params;
  const { q, type } = req.query;
  if (!q) return res.json([]);

  const searchTerm = `%${q}%`;
  let query = supabase
    .from('vocabs')
    .select('*, pages!inner(language_id, type)')
    .eq('pages.language_id', langId)
    .or(`target_word.ilike.${searchTerm},translation_de.ilike.${searchTerm},translation_en.ilike.${searchTerm},description.ilike.${searchTerm}`);

  if (type) query = query.eq('pages.type', type);

  const { data, error } = await query.limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/pages/:pageId/vocabs', async (req, res) => {
  const { pageId } = req.params;
  const { target_word, translation_de, translation_en, description, correct_answer_de, correct_answer_en, order_index } = req.body;
  const { data, error } = await supabase
    .from('vocabs')
    .insert([{ page_id: pageId, target_word, translation_de, translation_en, description, correct_answer_de, correct_answer_en, order_index: order_index || 0 }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'vocab_added', vocab: data });
  res.json(data);
});

app.put('/api/vocabs/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const { data, error } = await supabase
    .from('vocabs')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'vocab_updated', vocab: data });
  res.json(data);
});

app.delete('/api/vocabs/:id', async (req, res) => {
  const { id } = req.params;
  // Delete audio file if exists
  const { data: vocab } = await supabase.from('vocabs').select('audio_url').eq('id', id).single();
  if (vocab?.audio_url) {
    const filePath = path.join(__dirname, vocab.audio_url);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  const { error } = await supabase.from('vocabs').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'vocab_deleted', vocabId: id });
  res.json({ success: true });
});

// Vocab Audio Upload
app.post('/api/vocabs/:id/audio', upload.single('audio'), async (req, res) => {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });
  const audioUrl = `/uploads/${req.file.filename}`;
  const { data, error } = await supabase
    .from('vocabs')
    .update({ audio_url: audioUrl })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ url: audioUrl, vocab: data });
});

// ==================== GRAMMATIK API ====================

app.get('/api/languages/:langId/grammar', async (req, res) => {
  const { langId } = req.params;
  const { data, error } = await supabase
    .from('grammar_entries')
    .select('*')
    .eq('language_id', langId)
    .order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/languages/:langId/grammar', async (req, res) => {
  const { langId } = req.params;
  const { title, content, category } = req.body;
  const { data, error } = await supabase
    .from('grammar_entries')
    .insert([{ language_id: langId, title, content, category }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/api/grammar/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('grammar_entries')
    .update(req.body)
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/grammar/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('grammar_entries').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ==================== DEKLINATION API ====================

app.get('/api/languages/:langId/declensions', async (req, res) => {
  const { langId } = req.params;
  const { data, error } = await supabase
    .from('declensions')
    .select('*')
    .eq('language_id', langId)
    .order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/languages/:langId/declensions', async (req, res) => {
  const { langId } = req.params;
  const { word, table_data, notes } = req.body;
  const { data, error } = await supabase
    .from('declensions')
    .insert([{ language_id: langId, word, table_data, notes }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/api/declensions/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('declensions')
    .update(req.body)
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/declensions/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('declensions').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ==================== SCHRIFTZEICHEN API ====================

app.get('/api/languages/:langId/characters', async (req, res) => {
  const { langId } = req.params;
  const { data, error } = await supabase
    .from('characters')
    .select('*')
    .eq('language_id', langId)
    .order('order_index');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/languages/:langId/characters', async (req, res) => {
  const { langId } = req.params;
  const { character, romanization, meaning, stroke_order, order_index } = req.body;
  const { data, error } = await supabase
    .from('characters')
    .insert([{ language_id: langId, character, romanization, meaning, stroke_order, order_index: order_index || 0 }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/api/characters/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('characters')
    .update(req.body)
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/characters/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('characters').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ==================== FÄCHER API ====================

app.get('/api/subjects', async (req, res) => {
  const { data, error } = await supabase.from('subjects').select('*').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/subjects', async (req, res) => {
  const { name, description } = req.body;
  const { data, error } = await supabase
    .from('subjects')
    .insert([{ name, description }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/subjects/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('subjects').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.get('/api/subjects/:subjectId/cards', async (req, res) => {
  const { subjectId } = req.params;
  const { data, error } = await supabase
    .from('subject_cards')
    .select('*')
    .eq('subject_id', subjectId)
    .order('order_index');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/subjects/:subjectId/cards', async (req, res) => {
  const { subjectId } = req.params;
  const { question, answer, correct_answer, order_index } = req.body;
  const { data, error } = await supabase
    .from('subject_cards')
    .insert([{ subject_id: subjectId, question, answer, correct_answer, order_index: order_index || 0 }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/api/subject-cards/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('subject_cards')
    .update(req.body)
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/subject-cards/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('subject_cards').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ==================== LOCKS STATUS ====================

app.get('/api/locks', (req, res) => {
  res.json(locks);
});

// ==================== FRONTEND ====================

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Interner Serverfehler' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`O-Vok-Trainer läuft auf Port ${PORT}`);
});
