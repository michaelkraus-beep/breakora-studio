import asyncio
from database import engine
from sqlalchemy import text

async def main():
    async with engine.begin() as conn:
        print("Adding 'interval' column to squeeze_events table...")
        try:
            await conn.execute(text("ALTER TABLE squeeze_events ADD COLUMN interval VARCHAR;"))
            print("Column added successfully.")
        except Exception as e:
            print(f"Column might already exist or error occurred: {e}")
            
        print("Creating index on interval...")
        try:
            await conn.execute(text("CREATE INDEX ix_squeeze_events_interval ON squeeze_events (interval);"))
            print("Index created successfully.")
        except Exception as e:
            print(f"Index might already exist or error occurred: {e}")

if __name__ == "__main__":
    asyncio.run(main())
