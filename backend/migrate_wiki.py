import asyncio
from database import engine, Base
import models

async def create_wiki_table():
    print("Creating wiki_articles table...")
    async with engine.begin() as conn:
        # Create only the WikiArticle table, if it doesn't exist
        await conn.run_sync(models.WikiArticle.__table__.create, checkfirst=True)
    print("Table created successfully.")

if __name__ == "__main__":
    asyncio.run(create_wiki_table())
