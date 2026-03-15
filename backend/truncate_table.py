import asyncio
from database import engine
from sqlalchemy import text

async def main():
    async with engine.begin() as conn:
        print("Truncating squeeze_events...")
        await conn.execute(text("TRUNCATE TABLE squeeze_events RESTART IDENTITY;"))
        print("Table truncated.")

if __name__ == "__main__":
    asyncio.run(main())
