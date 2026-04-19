# Anilist Ultimate v2 🚀

> Modern TypeScript rewrite of Anilist Ultimate - The ultimate anime calendar extension

**Version:** 2.0.0
**Status:** 🏗️ Under Active Development (Phase 1: Foundation Complete)

---

## 🎯 Overview

Anilist Ultimate v2 is a complete architectural rewrite of the original extension, transitioning from vanilla JavaScript to a modern TypeScript-based architecture.

### Why v2?

- ❌ Original: 2000+ line monolithic files
- ❌ Original: Global namespace pollution
- ✅ New: TypeScript for type safety
- ✅ New: Vite for fast builds
- ✅ New: Custom State Management
- ✅ New: Component-based Architecture

---

## 🚀 Getting Started

### Installation

```bash
cd anilist-ultimate-v2
npm install
npm run dev
```

### Loading in Chrome

1. Build: `npm run build`
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Load unpacked → select `dist/` folder

---

## 📁 Project Structure

```
src/
├── core/           # Core utilities
├── modules/        # Feature modules
├── ui/             # Components
└── main.ts         # Entry point
```

---

## 💻 Development

```bash
npm run dev      # Development with HMR
npm run build    # Production build
npm test         # Run tests
npm run lint     # Lint code
```

---

## 📄 License

GPL-3.0
