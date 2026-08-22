<p align="center">
  <h1 align="center">🔐 OpenFB</h1>
  <p align="center"><strong>Open Source Facebook Messenger API Gateway — Powered by Camoufox</strong></p>
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-api">API</a> •
  <a href="#-architecture">Architecture</a>
</p>

---

## 🧭 What is OpenFB?

**OpenFB** is a free, open-source Facebook Messenger API gateway. It mirrors the
architecture of [OpenWA](https://github.com/rmyndharis/OpenWA) (a WhatsApp API
gateway) but is built for **Facebook Messenger** instead of WhatsApp, and uses
**[Camoufox](https://camoufox.com/)** (a patched Firefox anti-detect browser)
instead of Puppeteer or headless Chrome.

OpenFB exposes a clean HTTP API for sending/receiving messages, managing
conversations, and automating Facebook Messenger — all from a self-hosted
instance you control.

---

## ✨ Features

| Feature | Description |
| --- | --- |
| 🔓 **100% Open Source** | MIT licensed, no vendor lock-in |
| 🦊 **Camoufox Engine** | Anti-detect Firefox with C++-level fingerprint patching |
| 🖥️ **Dashboard** | React UI for session management and monitoring |
| 🔹 **Multi-Session** | Run multiple Facebook accounts concurrently |
| 🐳 **Docker Native** | Production-ready with zero configuration |
| 🔗 **Webhooks** | Receive incoming messages via signed HTTP webhooks |
| 📊 **Metrics** | Built-in metrics endpoint for monitoring |
| ⚡ **Rate Limiting** | Configurable per-session rate limits |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 22.13
- **Python** ≥ 3.10 (for Camoufox)
- **Camoufox** browser binary

### 1. Install Camoufox

```bash
pip install -U "camoufox[geoip]"
python -m camoufox fetch
```

### 2. Install OpenFB

```bash
git clone https://github.com/your-org/openfb.git
cd openfb
npm install
```

### 3. Configure

```bash
cp .env.example .env
# Edit .env — set API_KEY, CAMOUFOX options, etc.
```

### 4. Run

```bash
# Development (API + dashboard)
npm run dev

# Production
npm run prod
```

### 5. Docker

```bash
docker-compose up -d
```

The API will be available at `http://localhost:3000/api`
The dashboard at `http://localhost:3000/`
The API docs (Swagger) at `http://localhost:3000/api/docs`

---

## 📡 API

All endpoints require the `x-api-key` header.

### Sessions

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/session` | List all sessions |
| `POST` | `/api/session` | Create a new session (launches Camoufox) |
| `GET` | `/api/session/:id` | Get session details |
| `DELETE` | `/api/session/:id` | Destroy a session |
| `GET` | `/api/session/:id/screenshot` | Get browser screenshot |

### Messages

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/session/:id/message/text` | Send a text message |
| `POST` | `/api/session/:id/message/media` | Send media (image/file/audio) |

### Conversations

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/session/:id/conversation` | List conversations |
| `GET` | `/api/session/:id/conversation/:chatId/messages` | Get messages |
| `POST` | `/api/session/:id/conversation/markAsRead/:chatId` | Mark as read |

### Contacts

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/session/:id/contact/:contactId` | Get contact info |

### Marketplace

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/session/:id/marketplace/search` | Search Marketplace with filters |
| `POST` | `/api/session/:id/marketplace/search` | Search via POST body (same filters) |
| `GET` | `/api/session/:id/marketplace/item/:listingId` | Get listing details |

#### Marketplace search filters

All filters are optional except `query`:

| Filter | Type | Description |
| --- | --- | --- |
| `query` | string | Search text (required) |
| `location` | string | Location text (city, address) |
| `latitude` / `longitude` | number | Coordinates for radius search |
| `radiusKm` | number | Search radius in km |
| `minPrice` | number | Minimum price |
| `maxPrice` | number | Maximum price |
| `sortBy` | enum | `relevance`, `price_asc`, `price_desc`, `newest`, `nearest` |
| `condition` | enum[] | `new`, `used_like_new`, `used_good`, `used_fair` |
| `postedAfter` | ISO date | Only listings posted after this date |
| `itemType` | enum | `item`, `vehicle`, `housing`, `all` |
| `limit` | number | Max results (default 24) |

**Example — search iPhones under $500 within 10km:**

```bash
curl -G 'http://localhost:3000/api/session/SESSION_ID/marketplace/search' \
  -H 'x-api-key: YOUR_KEY' \
  --data-urlencode 'query=iPhone 13' \
  --data-urlencode 'minPrice=0' \
  --data-urlencode 'maxPrice=500' \
  --data-urlencode 'radiusKm=10' \
  --data-urlencode 'sortBy=price_asc' \
  --data-urlencode 'postedAfter=2026-08-01'
```

### Webhooks

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/webhook/test` | Send test event |
| `POST` | `/api/webhook/status` | Check webhook status |

### Health & Metrics

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Engine health check |
| `GET` | `/api/metrics` | Gateway metrics |

---

## 🏗️ Architecture

```
  ┌────────────────────────────────────────────────────────────────┐
  │  NestJS API (Node.js, TypeScript)                               │
  │  ───────────────────────────────────────────────────────────   │
  │  Session Module → Engine Module → CamoufoxFacebookFactory       │
  │  Message Module    Contact Module   Conversation Module        │
  │  Webhook Module    Health Module    Metrics Module             │
  └───────────────────────────┬────────────────────────────────────┘
                              │ Playwright (firefox.connectOverCDP)
                              ▼
  ┌────────────────────────────────────────────────────────────────┐
  │  Camoufox Remote Server (Python child process)                 │
  │  ───────────────────────────────────────────────────────────   │
  │  launch_server.py → camoufox.server.launch_server()            │
  │  Exposes: ws://localhost:PORT/ws-path                          │
  └───────────────────────────┬────────────────────────────────────┘
                              │ WebSocket (Playwright protocol)
                              ▼
  ┌────────────────────────────────────────────────────────────────┐
  │  Camoufox Browser (Patched Firefox binary)                     │
  │  ───────────────────────────────────────────────────────────   │
  │  • C++-level fingerprint patching (no JS shims)                │
  │  • Human-like cursor movement (Bezier curves)                  │
  │  • GeoIP-aware locale/timezone spoofing                         │
  │  • Persistent profiles (cookie/session storage)                │
  └───────────────────────────┬────────────────────────────────────┘
                              │ Browser DOM
                              ▼
                    ┌──────────────────┐
                    │  messenger.com    │
                    └──────────────────┘
```

### Why Camoufox instead of Puppeteer?

OpenWA uses `whatsapp-web.js` (Puppeteer/Chrome) and Baileys (WebSocket).
Both approaches are easily detected by anti-bot systems. Facebook's bot
detection is more aggressive than WhatsApp's, so OpenFB uses **Camoufox** —
a Firefox build patched at the **C++ source level** that:

- Spoofs Navigator, screen, GPU/WebGL, Canvas, fonts, audio, WebRTC, timezone
- Has no JavaScript shims or `Object.defineProperty` overrides
- Generates coherent fingerprints from real-world Firefox telemetry
- Supports human-like Bezier-curve mouse movement
- Matches geolocation/locale to proxy IP (GeoIP)

### Pluggable Engine

The `EngineAdapter` interface allows future engines to be added (e.g. an
official Facebook Graph API adapter) without changing application code —
the same pluggable pattern OpenWA uses.

---

## ⚠️ Disclaimer

OpenFB is an unofficial, community-maintained gateway. It is not affiliated
with, endorsed by, or sponsored by Meta Platforms, Inc. Use of this software
may violate Facebook's Terms of Service. You are solely responsible for how
you use this tool.

---

## 📄 License

MIT
