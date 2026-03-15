import asyncio
from database import engine, Base
import models # ensure tables are registered

async def main():
    async with engine.begin() as conn:
        print("Creating tables...")
        await conn.run_sync(Base.metadata.create_all)
        print("Tables created.")

if __name__ == "__main__":
    asyncio.run(main())
