# O-Vok-Trainer

Ein professioneller Vokabeltrainer für alle Sprachen und Schulfächer.

## 🚀 Einrichtung (Schritt für Schritt)

### 1. Supabase Datenbank einrichten

1. Gehe auf [supabase.com](https://supabase.com) und erstelle einen kostenlosen Account
2. Erstelle ein neues Projekt
3. Gehe zu **SQL Editor** und führe die komplette Datei `supabase_schema.sql` aus
4. Gehe zu **Settings → API** und kopiere:
   - `Project URL` → das ist dein `SUPABASE_URL`
   - `anon public key` → das ist dein `SUPABASE_ANON_KEY`

### 2. GitHub Repository erstellen

1. Gehe auf [github.com](https://github.com) und erstelle ein neues Repository namens `o-vok-trainer`
2. Lade alle Dateien in das Repository hoch (oder nutze Git):

```bash
git init
git add .
git commit -m "Initial commit: O-Vok-Trainer"
git branch -M main
git remote add origin https://github.com/DEIN-USERNAME/o-vok-trainer.git
git push -u origin main
```

### 3. Render.com Deployment

1. Gehe auf [render.com](https://render.com) und erstelle einen kostenlosen Account
2. Klicke auf **New → Web Service**
3. Verbinde dein GitHub Repository
4. Einstellungen:
   - **Name**: o-vok-trainer
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Unter **Environment Variables** füge hinzu:
   - `SUPABASE_URL` = deine Supabase Project URL
   - `SUPABASE_ANON_KEY` = dein Supabase anon key
6. Klicke **Create Web Service**

Nach wenigen Minuten ist dein Trainer live! 🎉

## 📱 Features

### Hauptmenü
- Alle Sprachen auf einen Blick
- Andere Schulfächer hinzufügen und üben
- Klick auf eine Sprache → 5 Bereiche

### Katalog
- Wörter und Sätze in separaten Katalogen
- Mehrere Seiten pro Sprache
- Seiten-MP3 zum Abspielen aller Vokabeln
- Einzel-MP3 pro Vokabel
- Übersetzung: Deutsch ↔ Englisch umschalten
- Suchfunktion für beide Sprachen

### Abfrage
- 5 Richtungen: Sprache→DE, DE→Sprache, Sprache→EN, EN→Sprache, Zufällig
- Anzahl der Vokabeln wählbar
- Stoppuhr pro Vokabel
- Punkte-System: 1 Punkt (1. Versuch), 0.5 (2-3. Versuch), 0 (3+)
- "Ich weiß nicht" Funktion
- Detaillierte Auswertung am Ende

### Grammatik-Helfer
- Grammatikregeln eintragen und verwalten
- Text-Prüfungs-Funktion

### Deklination
- Wörter in Tabellen beugen
- JSON-basierte Flexionstabellen

### Aussprache & Info
- Aussprache-Leitfaden
- Sprach-Informationen

### Schriftzeichen
- Zeichen mit Romanisierung und Bedeutung
- Canvas zum Nachmalen

## 🔐 Bearbeitung

Passwort: **0000**

Im Bearbeitungsmodus können bis zu 5 Personen gleichzeitig arbeiten, 
aber immer nur 1 Person pro Sprache (kein Konflikt).

## 🌍 Unterstützte Sprachen

Alle Sprachen mit Unicode-Support:
- Japanisch, Chinesisch, Koreanisch
- Arabisch, Hebräisch, Hindi
- Russisch, Griechisch
- Und alle anderen...
