import asyncio
from sqlalchemy import select
from database import AsyncSessionLocal
from models import WikiArticle

ARTICLE_CONTENT = """
# Market Scanner

The **Breakora Market Scanner** is a high-density, real-time asset discovery engine designed around the *Hive-Tech* hexagonal interface. It continuously monitors hundreds of assets asynchronously and visually organizes them by actionable metrics.

## Features & Navigation
- **Hexagonal Interface (Hive-Tech):** Assets are rendered as honeycomb tiles. The grid dynamically adjusts to your window width and prioritizes assets based on standard algorithm scores.
- **Contextual Preview:** Hovering over any hexagonal tile renders a **mini candlestick chart preview** in the upper right quadrant of the hive grid, allowing split-second momentum checks without crowding your dashboard.
- **Dashboard Spawing:** Clicking a tile instantly dispatches an event to the global layout orchestrator, spawning a full-featured chart tab within your main workspace.

## Advanced Filtering System
The scanner allows pinpoint asset discovery through categories accessible via the `FILTERS` drop-down:
1. **Core:** High-level essentials, such as 24-hour volume spikes or relative volume (`RVOL`).
2. **Technical:** Price-action momentum algorithms, including Relative Strength Index (RSI).
3. **Volatility & Liquidity:** Helps isolate coins that are moving aggressively, filtering out stagnant assets.
4. **Market (Market Cap Tiers):** Isolate MEGA, LARGE, MID, SMALL, or MICRO cap tiers effortlessly with color-coded toggle chips.

## Status Indicators
- **SCANNING (Cyan Pulse):** The background service is actively scraping up-to-date market statistics.
- **ACTIVE (Emerald Pulse):** The connection is stable and receiving granular ticker updates natively on the client.

*Use the "Reset Hive" button to instantly flush your active filters and return to default sorting defaults.*
"""

async def insert_scanner_article():
    async with AsyncSessionLocal() as session:
        slug = "market-scanner"
        title = "Market Scanner"
        category = "core"
        
        stmt = select(WikiArticle).where(WikiArticle.slug == slug)
        result = await session.execute(stmt)
        existing = result.scalar_one_or_none()
        
        if existing:
            existing.title = title
            existing.category = category
            existing.content = ARTICLE_CONTENT.strip()
            print("Updated existing market-scanner article.")
        else:
            new_article = WikiArticle(slug=slug, title=title, category=category, content=ARTICLE_CONTENT.strip())
            session.add(new_article)
            print("Inserted new market-scanner article.")
            
        await session.commit()

if __name__ == "__main__":
    asyncio.run(insert_scanner_article())
