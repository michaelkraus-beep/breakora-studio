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
6. [API Integrations]: always apply a debounce (at least 300-400ms) to rapid UI interactions (like hovering over grid items) that trigger heavy API or historical data fetches, because unprotected rapid-fire requests will trigger third-party (e.g., Binance) rate limits and cause silent data drops.
7. [State Management]: never duplicate granular, per-instance settings (like drawing tool configurations) inside global settings menus, because it creates redundant UI inputs and leads to state desynchronization.
8. [Documentation]: always synchronize updates across .cursorrules, CLAUDE.md, and INSTRUCTIONS.md so they contain the exact same content.
9. [Documentation]: always update the central 'PROJECT_STATE.md' file after completing a feature or making architectural changes or fixing an error. You must insert new implementations in their correct structural context and explicitly remove or modify any deprecated components, because the user requires a single, perfectly synchronized living documentation of the current project state. Use the information you provided in a new Walkthrough.md to the user to refine the documentation.
10. [Documentation]: always keep 'USER_MANUAL.md' up to date with new, modified, or removed components. Use it as the definitive source of truth to write content for the in-app Wiki subsystem, and ensure newly documented components expose a ContextualHelp `(?)` button linking to the corresponding Wiki article.