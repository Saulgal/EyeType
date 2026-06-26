# EyeType 👁

> An eye-controlled AAC (Augmentative and Alternative Communication) keyboard for users with paralysis. Type and speak using only your eyes.

---

## ✨ Features

- **🧿 Eye tracking** — Uses your webcam and MediaPipe FaceMesh AI (no hardware required)
- **👁 Blink to select** — Triple blink OR hold eyes closed 1 second to confirm a key
- **⏱ Dwell mode** — Gaze at a key and a progress ring fills to confirm (no blink needed)
- **💬 Word suggestions** — Words auto-suggested above the keyboard as you type
- **⚡ Quick phrases** — One-look access to Yes, No, Help, Water, Pain, and 16 more
- **🔊 Text-to-speech** — Speak your composed message aloud at any time
- **🌐 Multi-language** — English, Português (PT-BR), Español (and easy to extend)
- **📱 Cross-platform** — Works on any device with a modern browser and webcam

---

## 🚀 Getting Started

### Option 1 — Open directly (Windows)
1. Double-click `start.bat`
2. Allow camera access when Chrome asks
3. Complete the 9-point calibration (look at dots and blink)

### Option 2 — Open directly (Mac/Linux)
```bash
chmod +x start.sh
./start.sh
```

### Option 3 — Host for free on GitHub Pages
1. Push this repo to GitHub
2. Go to **Settings → Pages → Source → GitHub Actions**
3. GitHub will automatically deploy the app at `https://yourusername.github.io/repo-name/`
4. HTTPS means camera access works on mobile too!

### Option 4 — Local server (avoids any browser restrictions)
```bash
# Python 3
python -m http.server 8080

# Node.js
npx serve .
```
Then open `http://localhost:8080`

---

## 🎮 How to Use

### Calibration (first time only)
- Look at each of the 9 glowing dots
- Blink 3 times rapidly OR keep eyes closed for 1 second on each dot
- Calibration is saved — you won't need to redo it unless the room lighting changes significantly

### Typing
- Move your eyes over the keyboard — the nearest key highlights
- **Dwell mode**: hold your gaze on a key until the ring fills (default: 1.5 seconds)
- **Blink mode**: blink 3 times rapidly, OR hold eyes closed 1 second
- **Both**: either method works

### Quick Phrases
- Click or gaze at phrases in the left sidebar (Yes, No, Help, Water, etc.)
- They insert directly into your message

### Word Suggestions
- After typing a few letters, word completions appear above the keyboard
- Select a suggestion to complete the word

### Speak
- Press **Speak** (🔊) to read the entire message aloud
- Press again to stop
- Adjust volume and speed in Settings ⚙

---

## ⚙️ Settings

| Setting | Description |
|---------|-------------|
| Language | EN / PT-BR / ES (extensible) |
| Volume | Speech volume (0–100%) |
| Speed | Speech rate (slow ← → fast) |
| Dwell time | How long to hold gaze to confirm (600–4000 ms) |
| Input mode | Dwell only / Blink only / Both |
| Recalibrate | Redo the 9-point gaze calibration |

---

## 🧑‍💻 Adding a New Language

Edit `js/i18n.js` and add a new entry using `I18n.addLanguage()`:

```javascript
I18n.addLanguage('fr', {
  name: 'Français',
  flag: '🇫🇷',
  voiceLang: 'fr-FR',
  rtl: false,
  labels: { /* ... same keys as EN ... */ },
  quickPhrases: [ { text: 'Oui', emoji: '✅' }, /* ... */ ],
  words: ['a', 'et', 'de', /* ... */ ],
});
```

---

## 🏗️ Project Structure

```
MontionComm/
├── index.html              # App shell
├── css/
│   ├── main.css            # Design tokens, header, output, settings
│   ├── keyboard.css        # QWERTY keys, dwell rings
│   └── panels.css          # Sidebar phrases, calibration screen
├── js/
│   ├── i18n.js             # Language data + word lists
│   ├── tts.js              # Text-to-speech (Web Speech API)
│   ├── words.js            # Word prefix prediction
│   ├── eyetracker.js       # MediaPipe FaceMesh + blink detection
│   ├── calibration.js      # 9-point gaze calibration
│   ├── keyboard.js         # Keyboard rendering + gaze interaction
│   └── app.js              # Main orchestrator
├── .github/workflows/
│   └── deploy.yml          # GitHub Pages CI/CD
├── start.bat               # Windows launcher
└── start.sh                # Mac/Linux launcher
```

---

## 🌐 Browser Requirements

| Browser | Status |
|---------|--------|
| Chrome 90+ | ✅ Recommended |
| Edge 90+ | ✅ Supported |
| Firefox | ⚠️ Partial (MediaPipe may be slower) |
| Safari | ⚠️ Partial (Web Speech API limited) |
| Mobile Chrome | ✅ Works with front camera |

> **Note**: Internet connection required on first load to download MediaPipe AI models (~3MB). After that, models are cached and the app works offline.

---

## ♿ Accessibility

- High-contrast dark mode by default
- All interactive elements have ARIA labels
- Keyboard fallback: **Space** or **Enter** = blink confirm
- Large keys (minimum 52×56 px desktop, scales smaller on mobile)
- Smooth gaze cursor with dead-zone filtering

---

## 📜 License

MIT License — free to use, modify, and distribute.
