# BREAKORA - AUTONOMOUS PROJECT DIRECTIVE & SYSTEM MEMORY

## 1. INITIAL COMMAND (CRITICAL)
STOP. Before reading, writing, or modifying any code in this project, you MUST read this entire file. Section 2 contains the static architecture, but Section 5 ("Memory Sector") contains dynamic rules that override default behaviors. Ignoring them will result in task failure.

---

## 2. PROJECT OVERVIEW & SCOPE
**Breakora** is a complex, web-based algorithmic trading station and analytics platform. 
* **Dashboard & UI:** Highly interactive dashboard with tabbed charting (candlestick and footprint), custom indicators, and diverse market tools in separate windows.
* **Data Pipeline:** Real-time WebSocket aggregation from Binance with asynchronous database storage. Calculates proprietary footprint metrics.
* **Live Scanner:** Real-time filtering of asset activity. One-click opening of scanned assets into the main dashboard.
* **Future/Planned:** Direct algorithmic execution, backtesting, and AI/Machine Learning-driven strategy development.

## 3. TECH STACK & ARCHITECTURE
**Backend (Python/Async):**
* FastAPI, Uvicorn, PostgreSQL (via `asyncpg`), SQLAlchemy 2.0 (Async mode), WebSockets, `pandas` & `pandas_ta`, Pydantic.
**Frontend (React/TypeScript):**
* React 19 (Vite), Tailwind CSS v4, `flexlayout-react` (for draggable windows), `lucide-react`, `motion`, `idb`.
* ML Foundation: `@tensorflow/tfjs` and `@google/genai`.

## 4. SELF-MODIFICATION TRIGGERS & FORMATTING
You are a learning system. You have the strict obligation to edit this file and add new rules to Section 5 as soon as the following occurs:
* **Architectural Decision:** An agreement is reached regarding a new package, structure, or pattern.
* **Bug Discovery:** You cause an error because you misjudged project dependencies (e.g., synchronous calls in async environment).
* **User Veto/Preference:** The user explicitly forbids a specific library or states a coding preference.

**Formatting Rule:**
When a trigger fires, open this file and append the rule at the bottom of Section 5. You MUST strictly use the following sequentially numbered format:
`[Category]: never/always do X, because Y`

---

## 5. MEMORY SECTOR: Learned Project Rules
*(Autonomously append new project rules below this line)*

1. [Workflow]: always analyze the task and present a clear, step-by-step implementation plan first, because the user must explicitly approve the plan before any code is written or modified.
2. [Workflow]: always enforce the use of `.agents/workflows/thinktank.md` for vague tasks or complex features before writing code.
3. [Documentation]: always write code comments, docstrings, and documentation in clean, professional English.
4. [Error Handling]: never silently guess or force a fix; always describe the exact error, propose a structured fix, and wait for confirmation.
5. [Version Control]: always establish clear milestones and suggest a safe rollback point (e.g., a Git commit) before executing major architectural changes or risky modifications, because the user wants to prevent unrecoverable errors.