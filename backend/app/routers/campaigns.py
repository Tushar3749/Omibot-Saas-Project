"""
OmniBot SaaS — Campaigns Router
CRUD + CSV bulk import for promotional campaigns.
"""
import csv
import io
import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import CampaignCreate, CampaignUpdate

logger = logging.getLogger(__name__)
router = APIRouter()


def _compute_status(c: dict) -> str:
    if not c.get("is_active"):
        return "inactive"
    now = datetime.now(timezone.utc)
    start = c.get("start_date")
    end   = c.get("end_date")
    if start:
        try:
            s = datetime.fromisoformat(str(start).replace("Z", "+00:00"))
            if s.tzinfo is None:
                s = s.replace(tzinfo=timezone.utc)
            if now < s:
                return "scheduled"
        except Exception:
            pass
    if end:
        try:
            e = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
            if e.tzinfo is None:
                e = e.replace(tzinfo=timezone.utc)
            if now > e:
                return "expired"
        except Exception:
            pass
    return "active"


def _parse_date(s: str):
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%d/%m/%Y"):
        try:
            return datetime.strptime(s.strip(), fmt).isoformat()
        except ValueError:
            continue
    return None


# ─── List ─────────────────────────────────────────────────────────────────────
@router.get("/")
async def list_campaigns(tenant: dict = Depends(get_current_tenant)):
    result = (
        supabase.table("campaigns")
        .select("*")
        .eq("tenant_id", tenant["tenant_id"])
        .order("created_at", desc=True)
        .execute()
    )
    campaigns = result.data or []
    for c in campaigns:
        c["status"] = _compute_status(c)
    return campaigns


# ─── Create ───────────────────────────────────────────────────────────────────
@router.post("/", status_code=201)
async def create_campaign(body: CampaignCreate, tenant: dict = Depends(get_current_tenant)):
    row = {
        "campaign_id": str(uuid.uuid4()),
        "tenant_id":   tenant["tenant_id"],
        "name":        body.name,
        "description": body.description,
        "type":        body.type,
        "amount":      body.amount,
        "start_date":  body.start_date.isoformat() if body.start_date else None,
        "end_date":    body.end_date.isoformat()   if body.end_date   else None,
        "apply_to":    body.apply_to,
        "product_ids": body.product_ids or [],
        "is_active":   body.is_active,
    }
    result = supabase.table("campaigns").insert(row).execute()
    campaign = result.data[0]
    campaign["status"] = _compute_status(campaign)
    return campaign


# ─── Update ───────────────────────────────────────────────────────────────────
@router.patch("/{campaign_id}")
async def update_campaign(
    campaign_id: str,
    body: CampaignUpdate,
    tenant: dict = Depends(get_current_tenant),
):
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    if "start_date" in update_data and update_data["start_date"]:
        update_data["start_date"] = update_data["start_date"].isoformat()
    if "end_date" in update_data and update_data["end_date"]:
        update_data["end_date"] = update_data["end_date"].isoformat()
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = (
        supabase.table("campaigns")
        .update(update_data)
        .eq("tenant_id", tenant["tenant_id"])
        .eq("campaign_id", campaign_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Campaign not found")
    campaign = result.data[0]
    campaign["status"] = _compute_status(campaign)
    return campaign


# ─── Delete ───────────────────────────────────────────────────────────────────
@router.delete("/{campaign_id}", status_code=204)
async def delete_campaign(campaign_id: str, tenant: dict = Depends(get_current_tenant)):
    supabase.table("campaigns") \
        .delete() \
        .eq("tenant_id", tenant["tenant_id"]) \
        .eq("campaign_id", campaign_id) \
        .execute()
    return None


# ─── CSV Bulk Import ───────────────────────────────────────────────────────────
@router.post("/import/csv")
async def import_campaigns_csv(
    tenant: dict = Depends(get_current_tenant),
    file: UploadFile = File(...),
):
    """
    CSV columns: name, type(percentage/flat/bonus), amount,
                 description, start_date(YYYY-MM-DD), end_date(YYYY-MM-DD),
                 apply_to(all/specific), product_skus(comma-separated), is_active(true/false)
    """
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files accepted")

    raw = await file.read()
    if len(raw) > 2 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="CSV must be under 2 MB")

    tid     = tenant["tenant_id"]
    content = raw.decode("utf-8-sig", errors="replace")
    lines   = [l for l in content.splitlines() if l.strip() and not l.strip().startswith("#")]
    if not lines:
        raise HTTPException(status_code=400, detail="CSV is empty")

    reader = csv.DictReader(io.StringIO("\n".join(lines)))
    reader.fieldnames = [h.strip().lower() for h in (reader.fieldnames or [])]

    if not {"name", "type", "amount"}.issubset(set(reader.fieldnames or [])):
        raise HTTPException(status_code=422, detail="CSV must include: name, type, amount")

    imported, errors, warnings = 0, 0, []

    for row_num, raw_row in enumerate(reader, start=2):
        row = {k.strip().lower(): (v.strip() if v else "") for k, v in raw_row.items() if k}
        name = row.get("name", "")
        typ  = row.get("type", "percentage")
        amt  = row.get("amount", "")

        if not name or not amt:
            warnings.append({"row": row_num, "message": "Skipped — missing name or amount"})
            errors += 1
            continue

        try:
            amount_val = float(amt)
        except ValueError:
            warnings.append({"row": row_num, "message": f"Skipped — invalid amount '{amt}'"})
            errors += 1
            continue

        if typ not in ("percentage", "flat", "bonus"):
            typ = "percentage"

        apply_to = row.get("apply_to", "all")
        if apply_to not in ("all", "specific"):
            apply_to = "all"

        product_ids: list = []
        if apply_to == "specific" and row.get("product_skus"):
            skus = [s.strip() for s in row["product_skus"].split(",") if s.strip()]
            if skus:
                pr = supabase.table("products").select("product_id, sku") \
                    .eq("tenant_id", tid).in_("sku", skus).execute()
                product_ids = [p["product_id"] for p in (pr.data or [])]

        is_active = row.get("is_active", "true").lower() not in ("false", "0", "no")

        supabase.table("campaigns").insert({
            "campaign_id": str(uuid.uuid4()),
            "tenant_id":   tid,
            "name":        name,
            "description": row.get("description", ""),
            "type":        typ,
            "amount":      amount_val,
            "start_date":  _parse_date(row.get("start_date", "")),
            "end_date":    _parse_date(row.get("end_date", "")),
            "apply_to":    apply_to,
            "product_ids": product_ids,
            "is_active":   is_active,
        }).execute()
        imported += 1

    return {"imported": imported, "errors": errors, "warnings": warnings}
