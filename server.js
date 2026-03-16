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

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadDir = path.join(__dirname, process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

// Multer: Audio + Bilder
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const uploadAudio = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.ogg', '.m4a'];
    allowed.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Nur Audio erlaubt'));
  }
});
const uploadImage = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    allowed.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Nur Bilder erlaubt (JPG, PNG, GIF, WEBP)'));
  }
});

// ==================== WEBSOCKET ====================
const locks = {};
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
        if (locks[data.langId] && locks[data.langId].userId !== userId) {
          ws.send(JSON.stringify({ type: 'lock_denied', langId: data.langId })); return;
        }
        locks[data.langId] = { userId, timestamp: Date.now() };
        broadcast({ type: 'lock_update', locks }, ws);
        ws.send(JSON.stringify({ type: 'lock_granted', langId: data.langId }));
      } else if (data.type === 'unlock') {
        if (locks[data.langId]?.userId === userId) { delete locks[data.langId]; broadcast({ type: 'lock_update', locks }); }
      }
    } catch (e) {}
  });
  ws.on('close', () => {
    clients.delete(ws);
    let changed = false;
    for (const langId in locks) { if (locks[langId].userId === userId) { delete locks[langId]; changed = true; } }
    if (changed) broadcast({ type: 'lock_update', locks });
  });
});

function broadcast(data, exclude = null) {
  const msg = JSON.stringify(data);
  clients.forEach(c => { if (c !== exclude && c.readyState === 1) c.send(msg); });
}

// ==================== HELPER: delete file ====================
function deleteFile(url) {
  if (!url) return;
  const filePath = path.join(__dirname, url.startsWith('/') ? url.slice(1) : url);
  if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch(e) {} }
}

// ==================== LANGUAGES ====================
app.get('/api/languages', async (req, res) => {
  const { data, error } = await supabase.from('languages').select('*').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/languages', async (req, res) => {
  const { name, code, flag, info, pronunciation_guide } = req.body;
  const { data, error } = await supabase.from('languages').insert([{ name, code, flag, info, pronunciation_guide }]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'language_added', language: data });
  res.json(data);
});
app.put('/api/languages/:id', async (req, res) => {
  const { data, error } = await supabase.from('languages').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'language_updated', language: data });
  res.json(data);
});
app.delete('/api/languages/:id', async (req, res) => {
  const { error } = await supabase.from('languages').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'language_deleted', languageId: req.params.id });
  res.json({ success: true });
});

// ==================== PAGES ====================
app.get('/api/languages/:langId/pages', async (req, res) => {
  const { type } = req.query;
  let q = supabase.from('pages').select('*').eq('language_id', req.params.langId).order('order_index');
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/languages/:langId/pages', async (req, res) => {
  const { name, type, order_index, page_audio_url } = req.body;
  const { data, error } = await supabase.from('pages').insert([{ language_id: req.params.langId, name, type: type || 'word', order_index: order_index || 0, page_audio_url }]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'page_added', page: data });
  res.json(data);
});
app.put('/api/pages/:id', async (req, res) => {
  const { data, error } = await supabase.from('pages').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'page_updated', page: data });
  res.json(data);
});
app.delete('/api/pages/:id', async (req, res) => {
  const { error } = await supabase.from('pages').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'page_deleted', pageId: req.params.id });
  res.json({ success: true });
});
app.post('/api/pages/:id/audio', uploadAudio.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  const audioUrl = `/uploads/${req.file.filename}`;
  const { data, error } = await supabase.from('pages').update({ page_audio_url: audioUrl }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ url: audioUrl, page: data });
});
app.delete('/api/pages/:id/audio', async (req, res) => {
  const { data: page } = await supabase.from('pages').select('page_audio_url').eq('id', req.params.id).single();
  if (page?.page_audio_url) deleteFile(page.page_audio_url);
  const { data, error } = await supabase.from('pages').update({ page_audio_url: null }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, page: data });
});

// ==================== VOCABS ====================
app.get('/api/pages/:pageId/vocabs', async (req, res) => {
  const { data, error } = await supabase.from('vocabs').select('*').eq('page_id', req.params.pageId).order('order_index');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get('/api/languages/:langId/vocabs/search', async (req, res) => {
  const { q, type } = req.query;
  if (!q) return res.json([]);
  const searchTerm = `%${q}%`;
  let query = supabase.from('vocabs').select('*, pages!inner(language_id, type)').eq('pages.language_id', req.params.langId).or(`target_word.ilike.${searchTerm},translation_de.ilike.${searchTerm},translation_en.ilike.${searchTerm},description.ilike.${searchTerm}`);
  if (type) query = query.eq('pages.type', type);
  const { data, error } = await query.limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/pages/:pageId/vocabs', async (req, res) => {
  const { target_word, translation_de, translation_en, description, correct_answer_de, correct_answer_en, order_index } = req.body;
  const { data, error } = await supabase.from('vocabs').insert([{ page_id: req.params.pageId, target_word, translation_de, translation_en, description, correct_answer_de, correct_answer_en, order_index: order_index || 0 }]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'vocab_added', vocab: data });
  res.json(data);
});
app.put('/api/vocabs/:id', async (req, res) => {
  const { data, error } = await supabase.from('vocabs').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'vocab_updated', vocab: data });
  res.json(data);
});
app.delete('/api/vocabs/:id', async (req, res) => {
  const { data: vocab } = await supabase.from('vocabs').select('audio_url').eq('id', req.params.id).single();
  if (vocab?.audio_url) deleteFile(vocab.audio_url);
  const { error } = await supabase.from('vocabs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  broadcast({ type: 'vocab_deleted', vocabId: req.params.id });
  res.json({ success: true });
});
app.post('/api/vocabs/:id/audio', uploadAudio.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  const audioUrl = `/uploads/${req.file.filename}`;
  const { data, error } = await supabase.from('vocabs').update({ audio_url: audioUrl }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ url: audioUrl, vocab: data });
});
app.delete('/api/vocabs/:id/audio', async (req, res) => {
  const { data: vocab } = await supabase.from('vocabs').select('audio_url').eq('id', req.params.id).single();
  if (vocab?.audio_url) deleteFile(vocab.audio_url);
  const { data, error } = await supabase.from('vocabs').update({ audio_url: null }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, vocab: data });
});

// ==================== GRAMMAR ====================
app.get('/api/languages/:langId/grammar', async (req, res) => {
  const { data, error } = await supabase.from('grammar_entries').select('*').eq('language_id', req.params.langId).order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/languages/:langId/grammar', async (req, res) => {
  const { title, content, category } = req.body;
  const { data, error } = await supabase.from('grammar_entries').insert([{ language_id: req.params.langId, title, content, category }]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.put('/api/grammar/:id', async (req, res) => {
  const { data, error } = await supabase.from('grammar_entries').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/grammar/:id', async (req, res) => {
  const { error } = await supabase.from('grammar_entries').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ==================== DECLENSIONS ====================
app.get('/api/languages/:langId/declensions', async (req, res) => {
  const { data, error } = await supabase.from('declensions').select('*').eq('language_id', req.params.langId).order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/languages/:langId/declensions', async (req, res) => {
  const { word, table_data, notes } = req.body;
  const { data, error } = await supabase.from('declensions').insert([{ language_id: req.params.langId, word, table_data, notes }]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.put('/api/declensions/:id', async (req, res) => {
  const { data, error } = await supabase.from('declensions').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/declensions/:id', async (req, res) => {
  const { error } = await supabase.from('declensions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ==================== CHARACTERS ====================
app.get('/api/languages/:langId/characters', async (req, res) => {
  const { data, error } = await supabase.from('characters').select('*').eq('language_id', req.params.langId).order('order_index');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/languages/:langId/characters', async (req, res) => {
  const { character, romanization, meaning, stroke_order, order_index } = req.body;
  const { data, error } = await supabase.from('characters').insert([{ language_id: req.params.langId, character, romanization, meaning, stroke_order, order_index: order_index || 0 }]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.put('/api/characters/:id', async (req, res) => {
  const { data, error } = await supabase.from('characters').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/characters/:id', async (req, res) => {
  const { error } = await supabase.from('characters').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ==================== SUBJECTS ====================
app.get('/api/subjects', async (req, res) => {
  const { data, error } = await supabase.from('subjects').select('*').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/subjects', async (req, res) => {
  const { name, description } = req.body;
  const { data, error } = await supabase.from('subjects').insert([{ name, description }]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/subjects/:id', async (req, res) => {
  const { error } = await supabase.from('subjects').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ==================== SUBJECT CARDS (erweitert) ====================
app.get('/api/subjects/:subjectId/cards', async (req, res) => {
  const { data, error } = await supabase.from('subject_cards').select('*').eq('subject_id', req.params.subjectId).order('order_index');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/subjects/:subjectId/cards', async (req, res) => {
  const { question, answer, correct_answer, order_index, card_type, options, image_url, question_image_url } = req.body;
  const { data, error } = await supabase.from('subject_cards')
    .insert([{ subject_id: req.params.subjectId, question, answer, correct_answer, order_index: order_index || 0,
      card_type: card_type || 'text', options: options || null, image_url: image_url || null, question_image_url: question_image_url || null }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.put('/api/subject-cards/:id', async (req, res) => {
  const { data, error } = await supabase.from('subject_cards').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/subject-cards/:id', async (req, res) => {
  const { data: card } = await supabase.from('subject_cards').select('image_url,question_image_url').eq('id', req.params.id).single();
  if (card?.image_url) deleteFile(card.image_url);
  if (card?.question_image_url) deleteFile(card.question_image_url);
  const { error } = await supabase.from('subject_cards').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Image upload for subject cards
app.post('/api/subject-cards/:id/image', uploadImage.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Kein Bild' });
  const { field = 'image_url' } = req.body;
  const imageUrl = `/uploads/${req.file.filename}`;
  const update = {};
  update[field] = imageUrl;
  const { data, error } = await supabase.from('subject_cards').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ url: imageUrl, card: data });
});
app.delete('/api/subject-cards/:id/image', async (req, res) => {
  const { field = 'image_url' } = req.body;
  const { data: card } = await supabase.from('subject_cards').select('image_url,question_image_url').eq('id', req.params.id).single();
  if (field === 'image_url' && card?.image_url) deleteFile(card.image_url);
  if (field === 'question_image_url' && card?.question_image_url) deleteFile(card.question_image_url);
  const update = {};
  update[field] = null;
  const { data, error } = await supabase.from('subject_cards').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, card: data });
});

// Generic image upload (for temp before card creation)
app.post('/api/upload/image', uploadImage.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Kein Bild' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ==================== LOCKS ====================
app.get('/api/locks', (req, res) => res.json(locks));

// ==================== FRONTEND ====================
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Interner Serverfehler' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`O-Vok-Trainer läuft auf Port ${PORT}`));
