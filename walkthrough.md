# Breakora Wiki Implementation Walkthrough

## Overview

The Breakora Wiki Help System was successfully implemented, strictly adhering to the architectural guidelines (FastAPI/asyncpg backend, React 19/Tailwind v4/flexlayout-react frontend) and your specific design requirements. A dedicated Git branch (`wiki-feature`) was created as a fallback point before beginning execution.

## 1. Backend & Data Integration

- **Database Model**: Added the [WikiArticle](file:///f:/breakora-new/backend/models.py#43-50) model to the SQLAlchemy base.
- **Migration & Schema**: Written a standalone [backend/migrate_wiki.py](file:///f:/breakora-new/backend/migrate_wiki.py) script to asynchronously spin up the `wiki_articles` table securely without disrupting existing data structures.
- **Data Sync Utility**: Created [backend/sync_wiki.py](file:///f:/breakora-new/backend/sync_wiki.py) to act as the [.md](file:///f:/breakora-new/README.md) loader. By default, it parses the [README.md](file:///f:/breakora-new/README.md) file, slicing it by its markdown headings into individual articles and gracefully upserts them into PostgreSQL with sanitized slugs and correct categories (like `core` and `technical`).
- **REST APIs**: Fast endpoint routing added to [main.py](file:///f:/breakora-new/backend/main.py):
  - `GET /api/wiki/index`: Distributes the index map of available articles.
  - `GET /api/wiki/articles/{slug}`: Retrieves specific markdown content off the database layer. 

## 2. Dynamic Layout & Singleton Features

- **FlexLayout Setup**: Upgraded [src/components/dashboard/DashboardLayout.tsx](file:///f:/breakora-new/src/components/dashboard/DashboardLayout.tsx) to handle a [wiki](file:///f:/breakora-new/backend/main.py#419-426) component target.
- **Singleton Logic**: When a Wiki is requested, the dashboard scans the flex layout using `model.visitNodes()`.
  - **If open**, the layout engine shifts immediate focus (`Actions.selectTab`) to the active Wiki tab.
  - **If closed**, the engine deterministically opens a new tab. In both cases, an `open-wiki` and `wiki-navigate` custom event bus feeds the target slug to the live tab, causing an immediate, seamless content swap without reloading or spawning duplicates.

## 3. High-Tech Hexagonal Components

All frontend components map to the Breakora *Hive-Tech* aesthetics seamlessly:
- **[src/components/dashboard/HexWikiNav.tsx](file:///f:/breakora-new/src/components/dashboard/HexWikiNav.tsx)**: Traded boring vertical lists for a high-density, hexagonal layout cluster. Uses the `HEX_CLIP_WIDE` & `HEX_CLIP` CSS polygon paths to enforce the aesthetic.
- **[src/components/dashboard/WikiTab.tsx](file:///f:/breakora-new/src/components/dashboard/WikiTab.tsx)**: Uses `react-markdown` mounted on top of Tailwind's strict typography (`prose-invert`) layout. It hosts the side navigation and smoothly fetches articles asynchronously based on user clicks or deep-links.
- **[src/components/dashboard/ContextualHelp.tsx](file:///f:/breakora-new/src/components/dashboard/ContextualHelp.tsx)**: Built the [(?)](file:///f:/breakora-new/src/App.tsx#29-176) reusable icon integration. As a proof of concept, this was mounted right next to the **Market Scanner** title (top left of the widget). Clicking this [(?)](file:///f:/breakora-new/src/App.tsx#29-176) button smoothly commands the layout engine to jump to the `introduction` article inside the Wiki tab.

## Final Status 
All systems compiled correctly and type checks have passed. You can now launch the full stack, run the backend migration scripts if desired, and utilize the context-aware help buttons to navigate the new Wiki format.
