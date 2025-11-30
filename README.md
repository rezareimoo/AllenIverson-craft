# AllenIverson Bot 🏀⛏️

An AI-powered Minecraft bot that understands natural language commands using LLM (Ollama + Llama3). Control your bot through in-game chat or a modern web UI with a visual task queue manager.

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![Minecraft](https://img.shields.io/badge/Minecraft-1.18+-brightgreen)
![Ollama](https://img.shields.io/badge/Ollama-Required-blue)

## ✨ Features

- **Natural Language Commands** – Talk to the bot in-game chat using plain English
- **LLM-Powered Planning** – Ollama + Llama3 translates requests into multi-step task plans
- **Task Queue System** – Sequential execution of complex multi-step operations
- **Web UI Dashboard** – Visual task builder, queue management, and real-time inventory display
- **Real-time Updates** – Socket.io powered live sync between bot and UI
- **Smart Crafting** – Automatic recipe lookup with crafting table placement handling

### Supported Task Types

| Task | Description |
|------|-------------|
| `collect` | Gather blocks/items from the world |
| `craft` | Craft items (handles crafting tables automatically) |
| `place` | Place blocks from inventory |
| `move` | Navigate to a block or player |
| `follow` | Continuously follow a player |
| `inventory` | Report current inventory |
| `stop` | Stop all actions and clear the queue |

---

## 📋 Prerequisites

Before running this project, you need to install the following external dependencies that are **not included** in the package.json:

### 1. Minecraft Java Edition Server

You need a running Minecraft Java Edition server for the bot to connect to.

**Options:**

- **Official Server** – Download from [minecraft.net](https://www.minecraft.net/en-us/download/server)
- **Paper/Spigot** – Performance-optimized servers
- **Minecraft Realms** – Works with Realms (configure host appropriately)
- **LAN World** – Open a single-player world to LAN

**Server Requirements:**
- Minecraft Java Edition 1.18+ (auto-detects version)
- `online-mode=false` in `server.properties` if not using authentication
- Default port: `25565`

### 2. Ollama (LLM Engine)

Ollama is required to run the LLM that processes natural language commands.

**Installation:**

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Windows
# Download from https://ollama.ai/download
```

**Pull the Llama3 model:**

```bash
ollama pull llama3
```

**Start Ollama server:**

```bash
ollama serve
```

> Ollama runs on `http://localhost:11434` by default.

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd AllenIverson-craft
```

### 2. Install Dependencies

```bash
# Install bot dependencies
npm install

# Install UI dependencies
cd ui
npm install
cd ..
```

### 3. Configure Environment (Optional)

Create a `.env` file in the project root to customize settings:

```env
# Minecraft Server
MC_HOST=localhost
MC_PORT=25565
BOT_USERNAME=AllenIverson

# Ollama LLM
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3

# Web UI
UI_PORT=3001
```

All values have sensible defaults, so `.env` is optional for local development.

### 4. Start the Services

**Terminal 1 – Start Ollama:**
```bash
ollama serve
```

**Terminal 2 – Start Minecraft Server:**
```bash
cd /path/to/minecraft/server
java -Xmx2G -jar server.jar nogui
```

**Terminal 3 – Start the Bot:**
```bash
npm start
```

**Terminal 4 – Start the Web UI (Development Mode):**
```bash
npm run ui:dev
```

---

## 🎮 Usage

### In-Game Chat Commands

All commands must start with "Allen" (case-insensitive):

```
Allen collect 10 oak logs
Allen make me a wooden pickaxe
Allen come to me
Allen follow Steve
Allen go to the crafting table
Allen what's in your inventory
Allen stop
```

The bot will:
1. Parse your natural language command using the LLM
2. Generate a multi-step task plan
3. Execute tasks sequentially
4. Report progress in chat

### Web UI

Access the web interface at:
- **Development:** `http://localhost:5173`
- **Production:** `http://localhost:3001`

Features:
- **Task Builder** – Visual interface to create collect, craft, place, move, and follow tasks
- **Task Queue** – View, reorder, and remove pending tasks
- **Inventory Panel** – Real-time inventory with projected changes based on queued tasks
- **Feasibility Indicators** – Shows if craft tasks are possible with current/projected inventory

---

## 📁 Project Structure

```
AllenIverson-craft/
├── allenIverson.js      # Main bot entry point + Express/Socket.io server
├── brain.js             # LLM integration (Ollama) for natural language processing
├── handlers/            # Task execution handlers
│   ├── collect.js       # Block collection logic
│   ├── craft.js         # Crafting with recipe lookup
│   ├── place.js         # Block placement
│   ├── move.js          # Navigation/pathfinding
│   ├── follow.js        # Player following
│   ├── inventory.js     # Inventory reporting
│   └── stop.js          # Stop/interrupt handling
├── state/
│   └── botState.js      # Global bot state management
├── utils/
│   ├── blockNames.js    # Block/item name validation
│   ├── inventory.js     # Inventory utilities
│   ├── queue.js         # Task queue management
│   └── recipes.js       # Recipe lookup and formatting
├── config/
│   └── constants.js     # Configuration constants
└── ui/                  # React Web UI
    ├── src/
    │   ├── App.jsx
    │   ├── components/  # UI components
    │   ├── hooks/       # Custom React hooks
    │   ├── utils/       # Client-side utilities
    │   └── styles/      # Minecraft-themed CSS
    └── package.json
```

---

## 🔌 API Endpoints

The bot exposes a REST API on port `3001`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Bot connection status, position, health |
| GET | `/api/queue` | Current task queue |
| POST | `/api/queue` | Add tasks to queue |
| DELETE | `/api/queue/:index` | Remove task at index |
| DELETE | `/api/queue` | Clear entire queue |
| GET | `/api/inventory` | Current bot inventory |
| GET | `/api/blocks` | List of collectible blocks |
| GET | `/api/items` | List of craftable items |
| GET | `/api/recipe/:itemName` | Recipe details for an item |
| GET | `/api/players` | Online players |

---

## 🛠️ Development

### Running in Development Mode

```bash
# Start bot with auto-reload (if using nodemon)
npm run dev

# Start UI with hot-reload
npm run ui:dev
```

### Building for Production

```bash
# Build the UI
npm run ui:build

# The built UI will be served automatically by the bot at port 3001
npm start
```

---

## 🔧 Troubleshooting

### Bot won't connect to Minecraft server

- Verify the server is running and accepting connections
- Check `MC_HOST` and `MC_PORT` in your `.env`
- Ensure `online-mode=false` if not using authentication
- Try connecting manually with Minecraft client first

### LLM not responding

- Verify Ollama is running: `curl http://localhost:11434/api/tags`
- Check that llama3 model is pulled: `ollama list`
- Check `OLLAMA_HOST` in your `.env`

### Web UI not connecting

- Ensure the bot is running first (it hosts the API)
- Check browser console for WebSocket errors
- Verify CORS settings if using custom ports

---

## 📦 Dependencies

### NPM Packages (Installed via `npm install`)

- `mineflayer` – Minecraft bot framework
- `mineflayer-pathfinder` – Navigation and pathfinding
- `mineflayer-collectblock` – Block collection
- `minecraft-data` – Minecraft item/block data
- `ollama` – Ollama LLM client
- `express` – Web server
- `socket.io` – Real-time communication
- `cors` – Cross-origin requests
- `dotenv` – Environment configuration

### External (Must Install Separately)

- **Minecraft Java Edition Server** (1.18+)
- **Ollama** with **llama3** model

---

## 📄 License

ISC

---

## 🙏 Acknowledgments

- [Mineflayer](https://github.com/PrismarineJS/mineflayer) – The incredible Minecraft bot framework
- [Ollama](https://ollama.ai/) – Local LLM hosting made simple
- [PrismarineJS](https://github.com/PrismarineJS) – Minecraft protocol tools

