"""Client and campaign management endpoints."""

import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from backend.config import OBJECTIVES
from backend.api.deps import check_campaign_access, get_current_user
from backend.db.database import get_db
from backend.db.models import (
    Campaign,
    Client,
)

router = APIRouter()

_OBJECTIVE_ERROR = "objective şunlardan biri olmalı: " + ", ".join(OBJECTIVES)

logger = logging.getLogger(__name__)


@router.get("/clients")
def list_clients(
    year: int | None = Query(None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """List all clients, optionally filtered by year."""
    q = db.query(Client).options(joinedload(Client.campaigns))
    if year is not None:
        q = q.filter(Client.year == year)
    clients = q.order_by(Client.name).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "year": c.year,
            "objective": c.objective or "lead",
            "created_at": c.created_at,
            "campaign_count": len(c.campaigns),
        }
        for c in clients
    ]


@router.post("/clients")
def create_client(
    name: str = Body(..., embed=True),
    year: int = Body(..., embed=True),
    objective: str = Body("lead", embed=True),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Create a new client."""
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Client name is required")
    if objective not in OBJECTIVES:
        raise HTTPException(status_code=400, detail=_OBJECTIVE_ERROR)
    client = Client(
        name=name.strip(),
        year=year,
        objective=objective,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    db.add(client)
    db.commit()
    db.refresh(client)
    return {
        "id": client.id,
        "name": client.name,
        "year": client.year,
        "objective": client.objective,
        "created_at": client.created_at,
    }


@router.delete("/clients/{client_id}")
def delete_client(
    client_id: int,
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Delete a client and all its campaigns."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    db.delete(client)
    db.commit()
    return {"deleted": True, "id": client_id}


@router.get("/clients/{client_id}/campaigns")
def list_campaigns(
    client_id: int,
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """List campaigns for a client."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return [
        {
            "id": c.id,
            "client_id": c.client_id,
            "name": c.name,
            "budget": c.budget,
            "channels": c.channels.split(",") if c.channels else [],
            "status": c.status,
            "objective": c.objective or "lead",
            "lead_value": c.lead_value or 0.0,
            "created_at": c.created_at,
        }
        for c in client.campaigns
    ]


@router.post("/clients/{client_id}/campaigns")
def create_campaign(
    client_id: int,
    name: str = Body(..., embed=True),
    budget: float = Body(0.0, embed=True),
    channels: str = Body("", embed=True),
    objective: str | None = Body(None, embed=True),
    lead_value: float = Body(0.0, embed=True),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Create a new campaign under a client.

    objective defaults to the client's objective when not provided.
    """
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Campaign name is required")
    resolved_objective = objective if objective is not None else (client.objective or "lead")
    if resolved_objective not in OBJECTIVES:
        raise HTTPException(status_code=400, detail=_OBJECTIVE_ERROR)
    campaign = Campaign(
        client_id=client_id,
        name=name.strip(),
        budget=budget,
        channels=channels,
        objective=resolved_objective,
        lead_value=max(0.0, lead_value),
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return {
        "id": campaign.id,
        "client_id": campaign.client_id,
        "name": campaign.name,
        "budget": campaign.budget,
        "channels": campaign.channels.split(",") if campaign.channels else [],
        "status": campaign.status,
        "objective": campaign.objective,
        "lead_value": campaign.lead_value,
        "created_at": campaign.created_at,
    }


@router.patch("/campaigns/{campaign_id}")
def update_campaign(
    campaign_id: int,
    name: str | None = Body(None, embed=True),
    budget: float | None = Body(None, embed=True),
    status: str | None = Body(None, embed=True),
    objective: str | None = Body(None, embed=True),
    lead_value: float | None = Body(None, embed=True),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Update campaign fields — objective/lead_value/name/budget/status."""
    campaign = check_campaign_access(db, campaign_id, _user)
    if objective is not None:
        if objective not in OBJECTIVES:
            raise HTTPException(status_code=400, detail=_OBJECTIVE_ERROR)
        campaign.objective = objective
    if lead_value is not None:
        campaign.lead_value = max(0.0, lead_value)
    if name is not None and name.strip():
        campaign.name = name.strip()
    if budget is not None:
        if budget < 0:
            raise HTTPException(status_code=400, detail="Budget cannot be negative")
        campaign.budget = budget
    if status is not None:
        _VALID_STATUSES = {"active", "paused", "completed"}
        if status not in _VALID_STATUSES:
            raise HTTPException(status_code=400, detail=f"status must be one of: {', '.join(sorted(_VALID_STATUSES))}")
        campaign.status = status
    db.commit()
    db.refresh(campaign)
    return {
        "id": campaign.id,
        "client_id": campaign.client_id,
        "name": campaign.name,
        "budget": campaign.budget,
        "channels": campaign.channels.split(",") if campaign.channels else [],
        "status": campaign.status,
        "objective": campaign.objective,
        "lead_value": campaign.lead_value,
        "created_at": campaign.created_at,
    }


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(
    campaign_id: int,
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Delete a campaign."""
    campaign = check_campaign_access(db, campaign_id, _user)
    db.delete(campaign)
    db.commit()
    return {"deleted": True, "id": campaign_id}
