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
    priority:       int            = 99


class DiscountUpdate(BaseModel):
    discount_name:  Optional[str]        = None
    rule_ids:       Optional[list[str]]  = None
    effective_from: Optional[str]        = None
    effective_to:   Optional[str]        = None
    is_lifetime:    Optional[bool]       = None
    is_active:      Optional[bool]       = None
    priority:       Optional[int]        = None


class PriorityUpdate(BaseModel):
    priority: int


class SimulateRequest(BaseModel):
    product_sku:    Optional[str]   = None
    quantity:       int             = 1
    cart_value:     float           = 0.0
    customer_phone: Optional[str]   = None
    district:       Optional[str]   = None


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


_MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _next_month(y: int, m: int) -> tuple[int, int]:
    return (y, m + 1) if m < 12 else (y + 1, 1)


def _report_month_detail(tid: str, year: int, month: int) -> dict:
    """Discount breakdown for a single month."""
    from collections import defaultdict
    ny, nm = _next_month(year, month)
    try:
        od_rows = (
            supabase.table("order_discounts")
            .select("discount_id, discount_code, discount_name, discount_amount, order_id")
            .eq("tenant_id", tid)
            .gte("created_at", f"{year}-{month:02d}-01")
            .lt ("created_at", f"{ny}-{nm:02d}-01")
            .execute().data or []
        )
    except Exception:
        od_rows = []

    groups: dict = defaultdict(lambda: {"orders": set(), "total": 0.0, "name": "", "did": ""})
    for row in od_rows:
        code = row.get("discount_code", "")
        groups[code]["name"] = row.get("discount_name", "")
        groups[code]["did"]  = row.get("discount_id", "")
        groups[code]["orders"].add(row.get("order_id", ""))
        groups[code]["total"] += float(row.get("discount_amount") or 0)

    # Enrich with discount details (priority, is_active, rule_ids)
    dids = [g["did"] for g in groups.values() if g["did"]]
    disc_map: dict = {}
    if dids:
        try:
            rows = (
                supabase.table("discounts")
                .select("discount_id, is_active, priority, rule_ids")
                .eq("tenant_id", tid)
                .in_("discount_id", dids)
                .execute().data or []
            )
            disc_map = {r["discount_id"]: r for r in rows}
        except Exception:
            pass

    result_rows = []
    for code, data in sorted(groups.items(), key=lambda x: x[1]["total"], reverse=True):
        det = disc_map.get(data["did"], {})
        result_rows.append({
            "discount_id":           data["did"],
            "discount_code":         code,
            "discount_name":         data["name"],
            "rules_count":           len(det.get("rule_ids") or []),
            "orders_count":          len(data["orders"]),
            "total_discount_amount": round(data["total"], 2),
            "is_active":             det.get("is_active", True),
            "priority":              det.get("priority", 99),
        })

    total_disc   = sum(r["total_discount_amount"] for r in result_rows)
    total_orders = len({r.get("order_id") for r in od_rows})
    return {
        "year":                  year,
        "month":                 month,
        "label":                 f"{_MONTH_NAMES[month]} {year}",
        "total_discount_amount": round(total_disc, 2),
        "total_orders":          total_orders,
        "active_discounts":      len(result_rows),
        "rows":                  result_rows,
    }


@router.get("/report")
async def discounts_report(
    year:  Optional[int] = None,
    month: Optional[int] = None,
    tenant=Depends(get_current_tenant),
):
    tid = tenant["tenant_id"]
    now = datetime.now(timezone.utc)

    # Single month detail
    if year and month:
        return _report_month_detail(tid, year, month)

    # No params → last 12 months summary
    months_seq = []
    y, m = now.year, now.month
    for _ in range(12):
        months_seq.append((y, m))
        m -= 1
        if m == 0:
            m, y = 12, y - 1

    oldest_y, oldest_m = months_seq[-1]
    try:
        od_all = (
            supabase.table("order_discounts")
            .select("discount_id, discount_amount, order_id, created_at")
            .eq("tenant_id", tid)
            .gte("created_at", f"{oldest_y}-{oldest_m:02d}-01")
            .execute().data or []
        )
    except Exception:
        od_all = []

    # Bucket by YYYY-MM
    month_buckets: dict = {}
    for row in od_all:
        key = (row.get("created_at") or "")[:7]
        if key not in month_buckets:
            month_buckets[key] = {"orders": set(), "total": 0.0, "dids": set()}
        month_buckets[key]["orders"].add(row.get("order_id", ""))
        month_buckets[key]["total"] += float(row.get("discount_amount") or 0)
        if row.get("discount_id"):
            month_buckets[key]["dids"].add(row["discount_id"])

    result = []
    for my, mm in months_seq:
        key  = f"{my}-{mm:02d}"
        data = month_buckets.get(key, {})
        result.append({
            "year":                  my,
            "month":                 mm,
            "label":                 f"{_MONTH_NAMES[mm]} {my}",
            "orders_count":          len(data.get("orders", set())),
            "total_discount_amount": round(data.get("total", 0.0), 2),
            "active_discounts_count": len(data.get("dids", set())),
        })

    return {"months": result}


@router.get("/report/monthly")
async def discounts_report_monthly(tenant=Depends(get_current_tenant)):
    """12-month summary — alias for /report with no params."""
    tid = tenant["tenant_id"]
    now = datetime.now(timezone.utc)
    months_seq = []
    y, m = now.year, now.month
    for _ in range(12):
        months_seq.append((y, m))
        m -= 1
        if m == 0:
            m, y = 12, y - 1

    oldest_y, oldest_m = months_seq[-1]
    try:
        od_all = (
            supabase.table("order_discounts")
            .select("discount_id, discount_amount, order_id, created_at")
            .eq("tenant_id", tid)
            .gte("created_at", f"{oldest_y}-{oldest_m:02d}-01")
            .execute().data or []
        )
    except Exception:
        od_all = []

    month_buckets: dict = {}
    for row in od_all:
        key = (row.get("created_at") or "")[:7]
        if key not in month_buckets:
            month_buckets[key] = {"orders": set(), "total": 0.0, "dids": set()}
        month_buckets[key]["orders"].add(row.get("order_id", ""))
        month_buckets[key]["total"] += float(row.get("discount_amount") or 0)
        if row.get("discount_id"):
            month_buckets[key]["dids"].add(row["discount_id"])

    result = []
    for my, mm in months_seq:
        key  = f"{my}-{mm:02d}"
        data = month_buckets.get(key, {})
        result.append({
            "year":                   my,
            "month":                  mm,
            "label":                  f"{_MONTH_NAMES[mm]} {my}",
            "orders_count":           len(data.get("orders", set())),
            "total_discount_amount":  round(data.get("total", 0.0), 2),
            "active_discounts_count": len(data.get("dids", set())),
        })

    return {"months": result}


@router.get("/report/monthly/{year}/{month}")
async def discounts_report_monthly_detail(
    year: int, month: int, tenant=Depends(get_current_tenant),
):
    """Single month discount breakdown."""
    return _report_month_detail(tenant["tenant_id"], year, month)


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
            "tenant_id":      tid,
            "discount_name":  body.discount_name,
            "discount_code":  code,
            "rule_ids":       body.rule_ids,
            "effective_from": eff_from,
            "effective_to":   eff_to,
            "is_lifetime":    body.is_lifetime,
            "is_active":      body.is_active,
            "priority":       body.priority,
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

    # Enrich order_discounts with customer_phone from orders table
    order_ids = list({r["order_id"] for r in od_rows if r.get("order_id")})
    phone_map: dict = {}
    if order_ids:
        try:
            o_rows = (
                supabase.table("orders")
                .select("order_id, customer_phone, customer_name")
                .eq("tenant_id", tid)
                .in_("order_id", order_ids)
                .execute().data or []
            )
            phone_map = {r["order_id"]: r for r in o_rows}
        except Exception:
            pass

    for od in od_rows:
        oinfo = phone_map.get(od.get("order_id", ""), {})
        od["customer_phone"] = oinfo.get("customer_phone")
        od["customer_name"]  = oinfo.get("customer_name")

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


@router.put("/{discount_id}/priority")
async def update_discount_priority(
    discount_id: str, body: PriorityUpdate, tenant=Depends(get_current_tenant),
):
    tid = tenant["tenant_id"]
    res = (
        supabase.table("discounts")
        .update({"priority": body.priority})
        .eq("tenant_id", tid)
        .eq("discount_id", discount_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Discount not found")
    return _enrich(res.data, tid)[0]


@router.post("/{discount_id}/simulate")
async def simulate_discount(
    discount_id: str,
    body: SimulateRequest,
    tenant=Depends(get_current_tenant),
):
    """Simulate discount application for a given cart context without creating an order."""
    from app.services.discount_engine import (
        _check_single_rule, get_customer_metrics, _compute_amount,
    )
    tid = tenant["tenant_id"]

    disc = (
        supabase.table("discounts")
        .select("*")
        .eq("tenant_id", tid)
        .eq("discount_id", discount_id)
        .maybe_single()
        .execute().data
    )
    if not disc:
        raise HTTPException(404, "Discount not found")

    rule_ids = [str(r) for r in (disc.get("rule_ids") or [])]
    rules_data: list = []
    if rule_ids:
        try:
            rules_data = (
                supabase.table("discount_rules")
                .select("*")
                .eq("tenant_id", tid)
                .in_("rule_id", rule_ids)
                .execute().data or []
            )
        except Exception:
            pass
    rules_map = {str(r["rule_id"]): r for r in rules_data}

    metrics = get_customer_metrics(tid, customer_phone=body.customer_phone or None)

    ctx = {
        "cart_amount":  body.cart_value,
        "product_skus": [body.product_sku] if body.product_sku else [],
        "quantity":     body.quantity,
        "district":     body.district or "",
        "categories":   [],
    }

    rule_results = []
    for rid in rule_ids:
        rule = rules_map.get(rid)
        if not rule:
            continue
        hit, reason, reward = _check_single_rule(rule, metrics, ctx)
        disc_amount = _compute_amount(reward, body.cart_value) if hit else 0.0
        rule_results.append({
            "rule_id":        rid,
            "rule_name":      rule.get("rule_name", ""),
            "rule_type":      rule.get("rule_type", ""),
            "matched":        hit,
            "reason":         reason if hit else "Condition not met",
            "reward_type":    reward.get("reward_type", "percentage"),
            "discount_value": float(reward.get("discount_value", 0)),
            "discount_amount": round(disc_amount, 2),
        })

    matched = next((r for r in rule_results if r["matched"]), None)
    total_discount = matched["discount_amount"] if matched else 0.0
    net_amount     = round(max(0.0, body.cart_value - total_discount), 2)

    return {
        "discount_id":    discount_id,
        "discount_code":  disc.get("discount_code", ""),
        "discount_name":  disc.get("discount_name", ""),
        "cart_value":     body.cart_value,
        "rules":          rule_results,
        "total_discount": round(total_discount, 2),
        "net_amount":     net_amount,
    }


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
