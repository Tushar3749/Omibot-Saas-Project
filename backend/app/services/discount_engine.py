"""
OmniBot SaaS — Discount Engine
Pipeline:
  1. get_customer_metrics  — query orders table for lifetime stats
  2. match_rules           — check all active discount rules against metrics + cart
  3. apply_conflict_resolution — best_deal / priority_wins / stack_all / stack_with_cap
  4. get_discount_context  — full pipeline, returns dict ready for Gemini injection
"""
import logging
from datetime import date, datetime, timezone
from typing import Optional

from app.database import supabase

logger = logging.getLogger(__name__)


# ── Customer Metrics ──────────────────────────────────────────────────────────

def get_customer_metrics(
    tenant_id: str,
    customer_platform_id: Optional[str] = None,
    customer_phone: Optional[str] = None,
) -> dict:
    """
    Compute customer lifetime metrics from the orders table.
    Lookup by customer_platform_id (Messenger PSID) or customer_phone.
    """
    if not customer_platform_id and not customer_phone:
        return _empty_metrics()

    try:
        q = (supabase.table("orders")
             .select("agreed_price, product_id, product_name, created_at, status")
             .eq("tenant_id", tenant_id))

        if customer_platform_id:
            q = q.eq("customer_platform_id", customer_platform_id)
        else:
            q = q.eq("customer_phone", customer_phone)

        orders = (q.order("created_at", desc=False).execute()).data or []
    except Exception as e:
        logger.warning(f"Discount engine metrics query error: {e}")
        return _empty_metrics()

    if not orders:
        return _empty_metrics()

    total_orders = len(orders)
    prices       = [float(o.get("agreed_price") or 0) for o in orders]
    total_ltv    = sum(prices)
    avg_basket   = total_ltv / total_orders if total_orders else 0.0

    # Last order date
    last_order_days_ago, last_order_date = None, None
    try:
        last_str = (orders[-1].get("created_at") or "").replace("Z", "+00:00")
        if last_str:
            last_dt             = datetime.fromisoformat(last_str)
            now                 = datetime.now(timezone.utc)
            last_order_days_ago = (now - last_dt.astimezone(timezone.utc)).days
            last_order_date     = last_dt.date().isoformat()
    except Exception:
        pass

    product_ids = list({o["product_id"] for o in orders if o.get("product_id")})

    # Category lookup from products table
    previous_categories: list = []
    if product_ids:
        try:
            pr = (supabase.table("products")
                  .select("product_id, category")
                  .in_("product_id", product_ids)
                  .execute())
            previous_categories = list({p["category"] for p in (pr.data or []) if p.get("category")})
        except Exception:
            pass

    today = date.today()
    current_month_prefix  = f"{today.year}-{today.month:02d}"
    current_month_orders  = sum(
        1 for o in orders if (o.get("created_at") or "").startswith(current_month_prefix)
    )

    return {
        "total_orders":         total_orders,
        "total_lifetime_value": round(total_ltv, 2),
        "avg_basket_value":     round(avg_basket, 2),
        "last_order_days_ago":  last_order_days_ago,
        "last_order_date":      last_order_date,
        "previous_product_ids": product_ids,
        "previous_categories":  previous_categories,
        "current_month_orders": current_month_orders,
        "is_new_customer":      False,
    }


def _empty_metrics() -> dict:
    return {
        "total_orders":         0,
        "total_lifetime_value": 0.0,
        "avg_basket_value":     0.0,
        "last_order_days_ago":  None,
        "last_order_date":      None,
        "previous_product_ids": [],
        "previous_categories":  [],
        "current_month_orders": 0,
        "is_new_customer":      True,
    }


# ── Rule Matching ─────────────────────────────────────────────────────────────

def match_rules(
    tenant_id: str,
    metrics: dict,
    cart_context: Optional[dict] = None,
) -> list[dict]:
    """
    Check all active discount rules against customer metrics + cart context.
    Returns sorted list of matched rules (by priority asc).
    """
    try:
        rules = (supabase.table("discount_rules")
                 .select("*")
                 .eq("tenant_id", tenant_id)
                 .eq("is_active", True)
                 .order("priority")
                 .execute()).data or []
    except Exception as e:
        logger.warning(f"Discount engine rule fetch error: {e}")
        return []

    ctx          = cart_context or {}
    cart_amount  = float(ctx.get("cart_amount", 0))
    product_skus = list(ctx.get("product_skus") or [])
    categories   = list(ctx.get("categories") or [])
    district     = ctx.get("district")
    quantity     = int(ctx.get("quantity") or 1)

    today  = date.today()
    from datetime import datetime as _dt
    now_dt = _dt.now()

    matched = []

    for rule in rules:
        conds  = rule.get("conditions") or {}
        rtype  = rule["rule_type"]
        reward = dict(rule.get("reward") or {})
        hit    = False
        reason = ""

        # ── 1. Cart Value ──────────────────────────────────────────────────────
        if rtype == "cart_value":
            min_a = float(conds.get("min_amount", 0))
            if cart_amount >= min_a:
                hit    = True
                reason = f"Cart ৳{cart_amount:.0f} ≥ min ৳{min_a:.0f}"

        # ── 2. Repeated Customer ───────────────────────────────────────────────
        elif rtype == "repeated_customer":
            loda = metrics.get("last_order_days_ago")
            if loda is not None:
                for tier in conds.get("tiers", []):
                    fd = int(tier.get("from_days", 0))
                    td = int(tier.get("to_days", 9999))
                    if fd <= loda <= td:
                        hit    = True
                        reason = f"Last order {loda} days ago (tier {fd}–{td}d)"
                        reward = {"discount_type": "percentage",
                                  "discount_value": float(tier.get("discount_pct", 0))}
                        break

        # ── 3. New Customer ────────────────────────────────────────────────────
        elif rtype == "new_customer":
            if metrics.get("is_new_customer", True):
                hit    = True
                reason = "First-time customer"

        # ── 4. Specific Product ────────────────────────────────────────────────
        elif rtype == "specific_product":
            rule_skus = conds.get("skus", [])
            hits = [s for s in product_skus if s in rule_skus]
            if hits:
                hit    = True
                reason = f"SKU match: {hits[:3]}"

        # ── 5. Specific Category ───────────────────────────────────────────────
        elif rtype == "specific_category":
            rule_cats = conds.get("categories", [])
            hits = [c for c in categories if c in rule_cats]
            if hits:
                hit    = True
                reason = f"Category match: {hits[:3]}"

        # ── 6. Bulk Quantity ───────────────────────────────────────────────────
        elif rtype == "bulk_quantity":
            min_q = int(conds.get("min_quantity", 1))
            if quantity >= min_q:
                hit    = True
                reason = f"Qty {quantity} ≥ min {min_q}"
                reward = {"discount_type": "percentage",
                          "discount_value": float(conds.get("discount_pct", 0))}

        # ── 7. District ────────────────────────────────────────────────────────
        elif rtype == "district":
            if district and district in conds.get("districts", []):
                hit    = True
                reason = f"District: {district}"

        # ── 8. Time-Based ──────────────────────────────────────────────────────
        elif rtype == "time_based":
            active_days = [d.lower()[:3] for d in conds.get("days_of_week", [])]
            dow = now_dt.strftime("%a").lower()
            if dow in active_days:
                from_t = conds.get("from_time", "00:00")
                to_t   = conds.get("to_time",   "23:59")
                cur    = now_dt.strftime("%H:%M")
                if from_t <= cur <= to_t:
                    hit    = True
                    reason = f"Time rule: {dow} {cur}"
                    reward = {"discount_type": "percentage",
                              "discount_value": float(conds.get("discount_pct", 0))}

        # ── 9. Seasonal ────────────────────────────────────────────────────────
        elif rtype == "seasonal":
            start = conds.get("start_date")
            end   = conds.get("end_date")
            if start and end:
                try:
                    if date.fromisoformat(start) <= today <= date.fromisoformat(end):
                        hit    = True
                        reason = f"Seasonal: {conds.get('rule_name', 'Sale')}"
                except ValueError:
                    pass

        # ── 10. Lifetime Value ─────────────────────────────────────────────────
        elif rtype == "lifetime_value":
            min_ltv    = float(conds.get("min_lifetime_value", 0))
            actual_ltv = float(metrics.get("total_lifetime_value", 0))
            if actual_ltv >= min_ltv:
                hit    = True
                reason = f"LTV ৳{actual_ltv:.0f} ≥ ৳{min_ltv:.0f}"

        if hit:
            matched.append({
                "rule_id":        rule["rule_id"],
                "rule_name":      rule["rule_name"] or rtype,
                "rule_type":      rtype,
                "priority":       rule["priority"],
                "discount_type":  reward.get("discount_type", "percentage"),
                "discount_value": float(reward.get("discount_value", 0)),
                "reason":         reason,
            })

    return matched


# ── Conflict Resolution ───────────────────────────────────────────────────────

def apply_conflict_resolution(
    matched: list[dict],
    resolution: str,
    stack_cap: float,
    cart_amount: float,
) -> tuple[float, float, list[dict]]:
    """
    Returns (final_discount_pct, final_discount_flat, applied_rules).
    """
    if not matched:
        return 0.0, 0.0, []

    if resolution == "priority_wins":
        top = matched[0]
        if top["discount_type"] == "percentage":
            return float(top["discount_value"]), 0.0, [top]
        return 0.0, float(top["discount_value"]), [top]

    if resolution == "best_deal":
        best = max(matched, key=lambda r: (
            r["discount_value"] * cart_amount / 100
            if r["discount_type"] == "percentage"
            else r["discount_value"]
        ))
        if best["discount_type"] == "percentage":
            return float(best["discount_value"]), 0.0, [best]
        return 0.0, float(best["discount_value"]), [best]

    # stack_all or stack_with_cap
    total_pct  = sum(r["discount_value"] for r in matched if r["discount_type"] == "percentage")
    total_flat = sum(r["discount_value"] for r in matched if r["discount_type"] == "flat")

    if resolution == "stack_with_cap":
        total_pct = min(total_pct, stack_cap)

    return total_pct, total_flat, matched


# ── Main Entry Point ──────────────────────────────────────────────────────────

def get_discount_context(
    tenant_id: str,
    customer_platform_id: Optional[str] = None,
    customer_phone: Optional[str] = None,
    cart_context: Optional[dict] = None,
) -> dict:
    """
    Full pipeline: customer metrics → rule matching → conflict resolution.
    Returns a dict ready to inject into the Gemini system prompt.
    """
    metrics = get_customer_metrics(tenant_id, customer_platform_id, customer_phone)
    matched = match_rules(tenant_id, metrics, cart_context)

    resolution = "best_deal"
    stack_cap  = 30.0
    try:
        cfg = (supabase.table("ai_config")
               .select("conflict_resolution, discount_stack_cap")
               .eq("tenant_id", tenant_id)
               .maybe_single()
               .execute())
        if cfg and cfg.data:
            resolution = cfg.data.get("conflict_resolution") or "best_deal"
            stack_cap  = float(cfg.data.get("discount_stack_cap") or 30)
    except Exception as e:
        logger.warning(f"Discount engine config fetch error: {e}")

    cart_amount = float((cart_context or {}).get("cart_amount", 0))
    final_pct, final_flat, applied = apply_conflict_resolution(
        matched, resolution, stack_cap, cart_amount
    )

    discount_message = ""
    if final_pct > 0:
        reasons = "; ".join(r["reason"] for r in applied[:2] if r.get("reason"))
        discount_message = f"আপনি {final_pct:.0f}% ছাড় পাচ্ছেন! ({reasons})"
    elif final_flat > 0:
        discount_message = f"আপনি ৳{final_flat:.0f} ছাড় পাচ্ছেন!"

    discount_amount = (cart_amount * final_pct / 100) + final_flat if cart_amount > 0 else 0.0
    final_price     = max(0.0, cart_amount - discount_amount) if cart_amount > 0 else 0.0

    return {
        "customer_metrics":    metrics,
        "matched_rules":       matched,
        "applied_rules":       applied,
        "final_discount_pct":  round(final_pct, 2),
        "final_discount_flat": round(final_flat, 2),
        "discount_amount":     round(discount_amount, 2),
        "final_price":         round(final_price, 2),
        "discount_message":    discount_message,
        "resolution":          resolution,
    }
