import asyncio
from database import AsyncSessionLocal
from sqlalchemy import text

async def main():
    async with AsyncSessionLocal() as session:
        # Check if columns exist (using postgresql information_schema)
        try:
            # We use text() to execute raw SQL for ALTER TABLE
            # PostgreSQL syntax: ALTER TABLE IF EXISTS candles ADD COLUMN IF NOT EXISTS quote_volume FLOAT;
            print("Adding quote_volume column...")
            await session.execute(text("ALTER TABLE candles ADD COLUMN IF NOT EXISTS quote_volume FLOAT DEFAULT 0.0;"))
            
            print("Adding count column...")
            await session.execute(text("ALTER TABLE candles ADD COLUMN IF NOT EXISTS count INTEGER DEFAULT 0;"))
            
            await session.commit()
            print("Migration successful.")
        except Exception as e:
            print(f"Migration failed (it might have already been done): {e}")
            await session.rollback()

if __name__ == "__main__":
    asyncio.run(main())
