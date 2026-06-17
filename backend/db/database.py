"""Database connection setup."""

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from backend.config import DATABASE_URL

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def migrate_add_columns() -> None:
    """Add columns that exist in ORM models but are missing from the SQLite schema."""
    insp = inspect(engine)
    for table_name in insp.get_table_names():
        existing = {col["name"] for col in insp.get_columns(table_name)}
        model_cls = None
        for mapper in Base.registry.mappers:
            if hasattr(mapper.class_, "__tablename__") and mapper.class_.__tablename__ == table_name:
                model_cls = mapper.class_
                break
        if model_cls is None:
            continue
        for col in model_cls.__table__.columns:
            if col.name not in existing:
                col_type = col.type.compile(dialect=engine.dialect)
                default = ""
                if col.default is not None:
                    dv = col.default.arg
                    if isinstance(dv, str):
                        default = f" DEFAULT '{dv}'"
                    elif isinstance(dv, (int, float)):
                        default = f" DEFAULT {dv}"
                with engine.begin() as conn:
                    conn.execute(text(
                        f"ALTER TABLE {table_name} ADD COLUMN {col.name} {col_type}{default}"
                    ))


def get_db():
    """Yield a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
