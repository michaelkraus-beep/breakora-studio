
import asyncio
from database import engine, Base
import models # Ensure all models are registered with Base

async def init_db():
    print("Initializing database tables...")
    async with engine.begin() as conn:
        # This will create tables for all models inheriting from Base
        # including MonitoredSymbol if it's correctly added to models.py
        await conn.run_sync(Base.metadata.create_all)
    print("Database initialization complete.")

if __name__ == "__main__":
    asyncio.run(init_db())
