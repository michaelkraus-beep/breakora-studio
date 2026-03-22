import asyncio
import os
import re
from sqlalchemy import select
from database import AsyncSessionLocal
from models import WikiArticle

async def sync_readme():
    readme_path = os.path.join(os.path.dirname(__file__), "..", "README.md")
    if not os.path.exists(readme_path):
        print("README.md not found.")
        return

    with open(readme_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Split by level 2 headings
    sections = re.split(r'\n##\s+', content)
    
    # First section is usually header/intro
    intro = sections[0].strip()
    articles = []
    
    if intro:
        articles.append({
            "slug": "introduction",
            "title": "Introduction",
            "category": "core",
            "content": intro
        })
        
    for section in sections[1:]:
        lines = section.split('\n', 1)
        if not lines:
            continue
        title_line = lines[0].strip()
        body = lines[1].strip() if len(lines) > 1 else ""
        
        # Clean title of emojis for slug
        clean_title = re.sub(r'[^\w\s-]', '', title_line).strip()
        slug = clean_title.lower().replace(" ", "-")
        
        # Determine category
        category = "core"
        if "overview" in slug:
            category = "core"
        elif "tech" in slug:
            category = "technical"
        elif "setup" in slug:
            category = "technical"
        
        articles.append({
            "slug": slug,
            "title": title_line,
            "category": category,
            "content": f"## {title_line}\n\n{body}"
        })

    # Upsert into DB
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
    print(f"Synced {len(articles)} articles into Wiki DB.")

if __name__ == "__main__":
    asyncio.run(sync_readme())
