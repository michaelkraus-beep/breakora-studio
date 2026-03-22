# Breakora - System Instructions & Project Context

## 1. Project Overview & Scope
**Breakora** is a complex, web-based algorithmic trading station and analytics platform. 
* **Dashboard & UI:** Functions as a comprehensive trading terminal. It features a highly interactive dashboard with tabbed charting (candlestick and footprint charts), custom indicators, and diverse market tools (like "tape" reading) in separate windows.
* **Data Aggregation & Processing:** Collects market data via API (currently Binance, with architecture designed for multi-exchange integration). The backend calculates proprietary metrics (e.g., footprint data) and stores everything in a database.
* **Live Scanner:** A dedicated module that filters real-time asset activity based on customizable criteria. Users can click on scanned assets to instantly open them as new chart tabs in the dashboard.
* **Future/Planned Features:** Direct execution (manual trading and automated bots/alerts), a comprehensive backtesting environment for strategies, automated strategy application, and AI/Machine Learning-driven strategy development.

## 2. Tech Stack & Architecture

**Backend (Python/Async):**
* **Framework:** FastAPI (High-performance, async API)
* **Server:** Uvicorn
* **Database:** PostgreSQL accessed via `asyncpg`
* **ORM:** SQLAlchemy 2.0 (Async mode with `create_async_engine`)
* **Real-time Data:** `websockets` (for live market data streams)
* **Data Processing & Indicators:** `pandas` and `pandas_ta` (Technical Analysis)
* **Validation:** Pydantic

**Frontend (React/TypeScript):**
* **Core:** React 19 with Vite
* **Styling:** Tailwind CSS v4
* **Layout/UI:** `flexlayout-react` (Crucial for the draggable, tabbed trading dashboard windows), `lucide-react` (Icons), `motion` (Animations)
* **Client-side Storage:** `idb` (IndexedDB for caching/local data)
* **AI/ML Foundation:** `@tensorflow/tfjs` and `@google/genai` (For future strategy development and smart analysis)

## 3. Workflow & Coding Guidelines

* **Language & Documentation:** Write all code comments, docstrings, and documentation in clean, professional English. Keep comments concise but ensure complex logic is well-explained.
* **Planning First (Strict Rule):** Always analyze the task and present a clear, step-by-step implementation plan first. **Do not write, modify, or delete any code until the user explicitly approves the plan.**
* **Milestones & Rollbacks:** For major architectural changes or heavy refactoring, establish clear milestones. Suggest a safe rollback point (e.g., reminding the user to make a Git commit) before executing risky modifications. 
* **Error Handling:** If an error occurs (e.g., traceback, database issue, or failed test), do not silently guess or force a fix. Describe the exact error and its root cause to the user, propose a structured fix, and wait for explicit confirmation before applying the patch.