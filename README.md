# Live Voting App 🗳️

A modern, real-time live voting and polling web application with a **simple, classic, and dignified design**. Features multiple voting question types, dynamic QR code generation for effortless audience joining from mobile devices, in-browser camera QR code scanning, and instant live sync.

---

## 🌟 Key Features

### 1. Multiple Voting Types
- **Single Correct Answer (Quiz / Trivia)**:
  - Host configures question and marks correct option(s).
  - Participants vote in real-time.
  - Presenter triggers **"Reveal Correct Answer"** to highlight the winning choice in emerald gold, play victory chimes, burst confetti, and display official explanations.
- **Percentage of Vote / Multi-Choice (Poll / Opinion)**:
  - Real-time animated percentage bars and live vote distribution counter ($P_i = \frac{V_i}{\sum V} \times 100\%$).
- **Rating Scale / Score (1 to 5 Stars)**:
  - Real-time average score calculation (e.g., $4.8 / 5.0$) and rating distribution histogram.
- **Word Cloud / Open Response**:
  - Audience submits keywords or short phrases that dynamically cluster and scale font sizes based on frequency.
- **Binary / Yes-No Sentiment**:
  - Quick split-bar sentiment gauge with comparative percentages.

### 2. Simple & Classic Visual Design
- Refined editorial typography combining classic serif headers (`Playfair Display`, `Georgia`) with crisp modern sans-serif body (`Inter`).
- Dignified color palette: Classic Slate, Warm Ivory, Academic Blue, Emerald Green, and Warm Amber.
- Seamless **Dark Mode & Light Mode** toggle.
- Tactile, accessible cards with smooth animated transitions.

### 3. Enhanced QR Code & Join System
- **In-Browser Camera QR Scanner**: Participants can click **"📷 Scan QR Code with Camera"** on the home page to scan the presenter's screen directly from their browser without needing any separate scanner app!
- **Pure Client-Side Vector QR Engine**: Generates crisp SVG and high-resolution (1000x1000px) Canvas QR codes with zero external dependencies.
- **High-Res Download (PNG)**: Presenters can download a high-res QR code image with one click to embed in Google Slides, PowerPoint, Keynote, or printed handouts.
- **Projector Presentation Mode**: Dedicated full-screen presentation stage for displays and projectors showing real-time updating vote distribution bars, live vote counter, and large QR code with clear 1-2-3 scan instructions.

### 4. Real-Time Sync & Multi-Device Support
- **BroadcastChannel & Storage Event Sync**: Zero-latency instant synchronization across multiple browser windows and tabs on the same computer.
- **PowerShell LAN Server (`start-server.bat`)**: Auto-detects local Wi-Fi IP (e.g. `http://192.168.1.15:8080`) so phones on the same Wi-Fi network can scan and vote.

---

## 🚀 Quick Start

### Method 1: Direct Browser Launch
Simply open `index.html` in any modern web browser (Chrome, Edge, Firefox, Safari, Brave):
```
Double-click index.html
```

### Method 2: Local Network Server (for Mobile QR Code Scanning)
To let phones on your local Wi-Fi join by scanning the QR code:
1. Double-click `start-server.bat` (or run `powershell -File server.ps1`).
2. The server will output your local network address (e.g., `http://192.168.1.15:8080`) and open your browser.
3. Presenters can open the Projector View, and participants in the room can scan the QR code to vote!

---

## 📁 Project Structure

```
live-voting-app/
├── index.html               # Main Single-Page Application shell
├── css/
│   ├── styles.css           # Classic design system, typography, colors, layout
│   └── animations.css       # Smooth keyframes, percentage bar growth, confetti
├── js/
│   ├── app.js               # Application orchestrator, event bus, camera QR scanner
│   ├── state.js             # Reactive state management and local storage persistence
│   ├── sync.js              # Real-time synchronization layer (BroadcastChannel & Events)
│   ├── poll-engine.js       # Statistical math, percentage calculators, and scoring
│   ├── qr-generator.js      # Zero-dependency vector SVG / Canvas QR code generator
│   ├── audio.js             # Web Audio API subtle acoustic feedback and chimes
│   └── confetti.js          # Canvas celebration particle effect
├── server.ps1               # Lightweight PowerShell HTTP server with LAN IP detection
├── start-server.bat         # 1-click Windows launcher
└── README.md                # Documentation
```
