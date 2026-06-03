"""
OmniBot SaaS — Discounts Router
Named discount offers (discount_id, code, rule_ids, effective window).
Also exposes order_discounts read endpoints.

Route order (must declare literals BEFORE /{discount_id}):
  GET  /order/{order_id}
  GET  /report
  POST /
  GET  /
  GET  /{discount_id}
  PATCH/{discount_id}
  DELETE /{discount_id}
"""
import logging
import random
import string
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_tenant
from app.database import supabase

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Code generator ────────────────────────────────────────────

def _gen_code() -> str:
    today    = datetime.now().strftime("%Y%m%d")
    rand     = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"DISC-{today}-{rand}"


# ── Schemas ───────────────────────────────────────────────────

class DiscountCreate(BaseModel):
    discount_name:  str
    rule_ids:       list[str]      = []
    effective_from: Optional[str]  = None
    effective_to:   Optional[str]  = None
    is_lifetime:    bool           = False
    is_active:      bool           = True


class DiscountUpdate(BaseModel):
    discount_name:  Optional[str]        = None
    rule_ids:       Optional[list[str]]  = None
    effective_from: Optional[str]        = None
    effective_to:   Optional[str]        = None
    is_lifetime:    Optional[bool]       = None
    is_active:      Optional[bool]       = None


# ── Helpers ───────────────────────────────────────────────────

def _enrich(discounts: list, tenant_id: str) -> list:
    """Attach rule details and order stats to each discount."""
    all_rule_ids = list({str(rid) for d in discounts for rid in (d.get("rule_ids") or [])})
    rules_map: dict = {}
    if all_rule_ids:
        try:
            rows = (
                supabase.table("discount_rules")
                .select("rule_id, rule_name, rule_type, conditions, reward")
                .eq("tenant_id", tenant_id)
                .in_("rule_id", all_rule_ids)
                .execute().data or []
            )
            rules_map = {str(r["rule_id"]): r for r in rows}
        except Exception:
            pass

    codes = [d.get("discount_code") for d in discounts if d.get("discount_code")]
    orders_count_map: dict = {}
    total_disc_map:   dict = {}
    if codes:
        try:
            od_rows = (
                supabase.table("order_discounts")
                .select("discount_code, discount_amount")
                .eq("tenant_id", tenant_id)
                .in_("discount_code", codes)
                .execute().data or []
            )
            for row in od_rows:
                c = row["discount_code"]
                orders_count_map[c] = orders_count_map.get(c, 0) + 1
                total_disc_map[c]   = total_disc_map.get(c, 0.0) + float(row.get("discount_amount") or 0)
        except Exception:
            pass

    for d in discounts:
        d["rules"] = [
            rules_map[str(rid)]
            for rid in (d.get("rule_ids") or [])
            if str(rid) in rules_map
        ]
        code = d.get("discount_code", "")
        d["orders_count"]          = orders_count_map.get(code, 0)
        d["total_discount_amount"] = round(total_disc_map.get(code, 0.0), 2)

    return discounts


# ── Endpoints ─────────────────────────────────────────────────

@router.get("/order/{order_id}")
async def get_order_discounts(order_id: str, tenant=Depends(get_current_tenant)):
    """Return order_discounts rows for a given order."""
    tid = tenant["tenant_id"]
    rows = (
        supabase.table("order_discounts")
        .select("*")
        .eq("tenant_id", tid)
        .eq("order_id", order_id)
        .execute().data or []
    )
    total = sum(float(r.get("discount_amount") or 0) for r in rows)
    return {"order_id": order_id, "rows": rows, "total_discount": round(total, 2)}


@router.get("/report")
async def discounts_report(
    year:  Optional[int] = None,
    month: Optional[int] = None,
    tenant=Depends(get_current_tenant),
):
    """Usage stats for the specified month (defaults to current month)."""
    tid = tenant["tenant_id"]
    now = datetime.now(timezone.utc)
    y   = year  or now.year
    m   = month or now.month

    month_prefix = f"{y}-{m:02d}"
    try:
        od_rows = (
            supabase.table("order_discounts")
            .select("discount_code, discount_name, discount_amount, created_at")
            .eq("tenant_id", tid)
            .gte("created_at", f"{month_prefix}-01")
            .lt ("created_at", f"{y}-{m+1:02d}-01" if m < 12 else f"{y+1}-01-01")
            .execute().data or []
        )
    except Exception:
        od_rows = []

    from collections import defaultdict
    groups: dict = defaultdict(lambda: {"orders_count": 0, "total_discount_amount": 0.0, "discount_name": ""})
    for row in od_rows:
        code = row["discount_code"]
        groups[code]["discount_name"]        = row.get("discount_name", "")
        groups[code]["discount_code"]        = code
        groups[code]["orders_count"]        += 1
        groups[code]["total_discount_amount"] += float(row.get("discount_amount") or 0)

    rows = sorted(groups.values(), key=lambda x: x["total_discount_amount"], reverse=True)
    total_discount = sum(r["total_discount_amount"] for r in rows)

    return {
        "month":          f"{y}-{m:02d}",
        "active_discounts": len(rows),
        "total_discount_amount": round(total_discount, 2),
        "rows": [{"discount_code": r["discount_code"],
                  "discount_name": r["discount_name"],
                  "orders_count":  r["orders_count"],
                  "total_discount_amount": round(r["total_discount_amount"], 2)}
                 for r in rows],
    }


@router.get("/")
async def list_discounts(tenant=Depends(get_current_tenant)):
    tid  = tenant["tenant_id"]
    rows = (
        supabase.table("discounts")
        .select("*")
        .eq("tenant_id", tid)
        .order("created_at", desc=True)
        .execute().data or []
    )
    return _enrich(rows, tid)


@router.post("/")
async def create_discount(body: DiscountCreate, tenant=Depends(get_current_tenant)):
    tid  = tenant["tenant_id"]
    code = _gen_code()
    eff_from = body.effective_from or datetime.now(timezone.utc).isoformat()
    eff_to   = None if body.is_lifetime else body.effective_to

    res = (
        supabase.table("discounts")
        .insert({
            "tenant_id":     tid,
            "discount_name": body.discount_name,
            "discount_code": code,
            "rule_ids":      body.rule_ids,
            "effective_from": eff_from,
            "effective_to":  eff_to,
            "is_lifetime":   body.is_lifetime,
            "is_active":     body.is_active,
        })
        .execute()
    )
    if not res.data:
        raise HTTPException(500, "Failed to create discount")
    return _enrich(res.data, tid)[0]


@router.get("/{discount_id}")
async def get_discount(discount_id: str, tenant=Depends(get_current_tenant)):
    tid = tenant["tenant_id"]
    row = (
        supabase.table("discounts")
        .select("*")
        .eq("tenant_id", tid)
        .eq("discount_id", discount_id)
        .maybe_single()
        .execute().data
    )
    if not row:
        raise HTTPException(404, "Discount not found")

    enriched = _enrich([row], tid)[0]

    # Attach full order_discounts history
    try:
        od_rows = (
            supabase.table("order_discounts")
            .select("*")
            .eq("tenant_id", tid)
            .eq("discount_code", row["discount_code"])
            .order("created_at", desc=True)
            .limit(100)
            .execute().data or []
        )
    except Exception:
        od_rows = []

    enriched["order_discounts"] = od_rows
    return enriched


@router.patch("/{discount_id}")
@router.put("/{discount_id}")
async def update_discount(discount_id: str, body: DiscountUpdate, tenant=Depends(get_current_tenant)):
    tid     = tenant["tenant_id"]
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if body.is_lifetime is True:
        updates["effective_to"] = None
    if not updates:
        raise HTTPException(400, "No fields to update")
    res = (
        supabase.table("discounts")
        .update(updates)
        .eq("tenant_id", tid)
        .eq("discount_id", discount_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Discount not found")
    return _enrich(res.data, tid)[0]


@router.delete("/{discount_id}")
async def delete_discount(discount_id: str, tenant=Depends(get_current_tenant)):
    (
        supabase.table("discounts")
        .delete()
        .eq("tenant_id", tenant["tenant_id"])
        .eq("discount_id", discount_id)
        .execute()
    )
    return {"ok": True}
