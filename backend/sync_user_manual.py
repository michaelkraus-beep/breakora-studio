import asyncio
import os
import re
from sqlalchemy import select
from database import AsyncSessionLocal
from models import WikiArticle

async def sync_user_manual():
    manual_path = os.path.join(os.path.dirname(__file__), "..", "USER_MANUAL.md")
    if not os.path.exists(manual_path):
        print("USER_MANUAL.md not found.")
        return

    with open(manual_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Split by level 2 headings
    sections = re.split(r'\n##\s+', content)
    
    intro = sections[0].strip()
    articles = []
    
    if intro:
        articles.append({
            "slug": "user-manual-intro",
            "title": "User Manual Introduction",
            "category": "core",
            "content": intro
        })
        
    for section in sections[1:]:
        lines = section.split('\n', 1)
        if not lines:
            continue
        title_line = lines[0].strip()
        body = lines[1].strip() if len(lines) > 1 else ""
        
        # Remove leading numbers like "1. " or "2. "
        clean_name = re.sub(r'^\d+\.\s*', '', title_line)
        
        # Create slug: lowercase, replace & with nothing, replace spaces with hyphens
        slug_base = clean_name.lower()
        slug_base = re.sub(r'[^\w\s-]', '', slug_base) # remove special chars
        slug = re.sub(r'\s+', '-', slug_base.strip())
        
        category = "technical"
        if "scanner" in slug or "intro" in slug or "dashboard" in slug or "wiki" in slug:
            category = "core"
            
        articles.append({
            "slug": slug,
            "title": clean_name,
            "category": category,
            "content": f"## {clean_name}\n\n{body}"
        })

    async with AsyncSessionLocal() as session:
        for article_data in articles:
            stmt = select(WikiArticle).where(WikiArticle.slug == article_data["slug"])
            result = await session.execute(stmt)
            existing = result.scalar_one_or_none()
            
            if existing:
                existing.title = article_data["title"]
                existing.category = article_data["category"]
                existing.content = article_data["content"]
            else:
                new_article = WikiArticle(**article_data)
                session.add(new_article)
        
        await session.commit()
    print(f"Synced {len(articles)} articles from USER_MANUAL.md into Wiki DB.")
    for a in articles:
        print(f" - [{a['category']}] {a['title']} -> {a['slug']}")

if __name__ == "__main__":
    asyncio.run(sync_user_manual())
