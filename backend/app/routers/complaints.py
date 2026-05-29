"""
OmniBot SaaS — Complaints Router
AI-detected + manual complaint management.
"""
import uuid, logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import ComplaintCreate, ComplaintUpdate

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/stats")
async def complaint_stats(tenant: dict = Depends(get_current_tenant)):
    all_c = (
        supabase.table("complaints")
        .select("status,priority")
        .eq("tenant_id", tenant["tenant_id"])
        .execute().data or []
    )
    return {
        "total":         len(all_c),
        "open":          sum(1 for c in all_c if c["status"] == "open"),
        "in_progress":   sum(1 for c in all_c if c["status"] == "in_progress"),
        "resolved":      sum(1 for c in all_c if c["status"] == "resolved"),
        "high_priority": sum(1 for c in all_c if c["priority"] == "high"),
    }


@router.get("/")
async def list_complaints(
    status: str = None,
    tenant: dict = Depends(get_current_tenant),
):
    query = (
        supabase.table("complaints")
        .select("*")
        .eq("tenant_id", tenant["tenant_id"])
        .order("created_at", desc=True)
    )
    if status:
        query = query.eq("status", status)
    return query.execute().data or []


@router.post("/", status_code=201)
async def create_complaint(body: ComplaintCreate, tenant: dict = Depends(get_current_tenant)):
    row = {
        "complaint_id":      str(uuid.uuid4()),
        "tenant_id":         tenant["tenant_id"],
        "conversation_id":   body.conversation_id,
        "customer_name":     body.customer_name,
        "customer_id":       body.customer_id,
        "product_mentioned": body.product_mentioned,
        "complaint_text":    body.complaint_text,
        "complaint_type":    body.complaint_type,
        "priority":          body.priority,
        "source":            "manual",
        "status":            "open",
    }
    result = supabase.table("complaints").insert(row).execute()
    return result.data[0]


@router.patch("/{complaint_id}")
async def update_complaint(complaint_id: str, body: ComplaintUpdate, tenant: dict = Depends(get_current_tenant)):
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    if body.status == "resolved":
        update_data["resolved_at"] = datetime.now(timezone.utc).isoformat()
    result = (
        supabase.table("complaints")
        .update(update_data)
        .eq("tenant_id", tenant["tenant_id"])
        .eq("complaint_id", complaint_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Complaint not found")
    return result.data[0]
