import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from dotenv import load_dotenv

load_dotenv()

# We will use asyncpg for asynchronous database operations
# The user specified the password "breakora" for the "postgres" user.
DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "postgresql+asyncpg://postgres:breakora@localhost:5432/postgres"
)

# Create the async SQLAlchemy engine
engine = create_async_engine(
    DATABASE_URL,
    echo=False, # Disabled to prevent log flooding and unresponsiveness
    pool_size=20,
    max_overflow=10,
    pool_timeout=30,
)

# Async session factory
AsyncSessionLocal = async_sessionmaker(
    engine, 
    class_=AsyncSession, 
    expire_on_commit=False
)

Base = declarative_base()

# Dependency to get a database session
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
