"""FastAPI application entry point for Attribution Intelligence Hub."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes import router

app = FastAPI(
    title="Attribution Intelligence Hub",
    description="Multi-channel attribution modelling API for PO AutoMatic Filo",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/")
def root() -> dict[str, str]:
    return {"status": "ok", "service": "Attribution Intelligence Hub"}
