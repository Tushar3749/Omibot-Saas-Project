"""
OmniBot SaaS — Discount Engine v3
Pipeline:
  1. Fetch all active discounts (is_active=true, within effective window)
  2. For each discount, check its rule_ids against customer + cart
  3. Apply conflict resolution → pick winning discount
  4. Return context dict for webhook_service to persist
"""
import logging
from datetime import date, datetime, timezone
from typing import Optional

from app.database import supabase

logger = logging.getLogger(__name__)


# ── Customer Metrics ──────────────────────────────────────────

def get_customer_metrics(
    tenant_id: str,
    customer_platform_id: Optional[str] = None,
    customer_phone: Optional[str] = None,
) -> dict:
    if not customer_platform_id and not customer_phone:
        return _empty_metrics()
    try:
        q = (supabase.table("orders")
             .select("agreed_price, product_id, created_at, status")
             .eq("tenant_id", tenant_id))
        if customer_platform_id:
            q = q.eq("customer_platform_id", customer_platform_id)
        else:
            q = q.eq("customer_phone", customer_phone)
        orders = q.order("created_at", desc=False).execute().data or []
    except Exception as e:
        logger.warning(f"[DiscountEngine] metrics error: {e}")
        return _empty_metrics()

    if not orders:
        return _empty_metrics()

    prices     = [float(o.get("agreed_price") or 0) for o in orders]
    total_ltv  = sum(prices)
    total_orders = len(orders)
    avg_basket = total_ltv / total_orders if total_orders else 0.0

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
    previous_categories: list = []
    if product_ids:
        try:
            pr = (supabase.table("products")
                  .select("category")
                  .in_("product_id", product_ids)
                  .execute())
            previous_categories = list({p["category"] for p in (pr.data or []) if p.get("category")})
        except Exception:
            pass

    today = date.today()
    month_prefix = f"{today.year}-{today.month:02d}"
    current_month_orders = sum(
        1 for o in orders if (o.get("created_at") or "").startswith(month_prefix)
    )

    return {
        "total_orders":         total_orders,
        "total_lifetime_value": round(total_ltv, 2),
        "avg_basket_value":     round(avg_basket, 2),
        "last_order_days_ago":  last_order_days_ago,
        "last_order_date":      last_order_date,
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
        "previous_categories":  [],
        "current_month_orders": 0,
        "is_new_customer":      True,
    }


# ── Single Rule Checker ───────────────────────────────────────

def _check_single_rule(rule: dict, metrics: dict, ctx: dict) -> tuple[bool, str, dict]:
    """Returns (hit, reason, reward_dict) for one rule."""
    rtype  = rule["rule_type"]
    conds  = rule.get("conditions") or {}
    reward = dict(rule.get("reward") or {})

    cart_amount  = float(ctx.get("cart_amount", 0))
    product_skus = list(ctx.get("product_skus") or [])
    categories   = list(ctx.get("categories") or [])
    district     = ctx.get("district")
    quantity     = int(ctx.get("quantity") or 1)
    today        = date.today()
    now_dt       = datetime.now()

    if rtype == "cart_value":
        min_a = float(conds.get("min_amount", 0))
        if cart_amount >= min_a:
            return True, f"Cart ৳{cart_amount:.0f} ≥ ৳{min_a:.0f}", reward

    elif rtype == "repeated_customer":
        loda = metrics.get("last_order_days_ago")
        if loda is not None:
            for tier in conds.get("tiers", []):
                fd = int(tier.get("from_days", 0))
                td = int(tier.get("to_days", 9999))
                if fd <= loda <= td:
                    tr = tier.get("reward") or (
                        {"reward_type": "percentage",
                         "discount_value": float(tier.get("discount_pct", 0)),
                         "bonus_items": []}
                        if tier.get("discount_pct") else reward
                    )
                    return True, f"Last order {loda} days ago", tr

    elif rtype == "new_customer":
        if metrics.get("is_new_customer", True):
            return True, "First-time customer", reward

    elif rtype == "specific_product":
        rule_skus = conds.get("skus", [])
        hits = [s for s in product_skus if s in rule_skus]
        if hits:
            return True, f"SKU match: {hits[:2]}", reward

    elif rtype == "specific_category":
        rule_cats = conds.get("categories", [])
        hits = [c for c in categories if c in rule_cats]
        if hits:
            return True, f"Category match: {hits[:2]}", reward

    elif rtype == "bulk_quantity":
        min_q = int(conds.get("min_quantity", 1))
        if quantity >= min_q:
            r = reward.copy()
            if not r.get("reward_type") and conds.get("discount_pct"):
                r = {"reward_type": "percentage",
                     "discount_value": float(conds["discount_pct"]),
                     "bonus_items": []}
            return True, f"Qty {quantity} ≥ min {min_q}", r

    elif rtype == "district":
        rule_districts = conds.get("districts", [])
        if district and rule_districts:
            addr_lower = district.lower()
            for d in rule_districts:
                if d.lower() in addr_lower:
                    return True, f"District: {d}", reward

    elif rtype == "time_based":
        active_days = [d.lower()[:3] for d in conds.get("days_of_week", [])]
        dow = now_dt.strftime("%a").lower()
        if dow in active_days:
            from_t = conds.get("from_time", "00:00")
            to_t   = conds.get("to_time",   "23:59")
            cur    = now_dt.strftime("%H:%M")
            if from_t <= cur <= to_t:
                r = reward.copy()
                if not r.get("reward_type") and conds.get("discount_pct"):
                    r = {"reward_type": "percentage",
                         "discount_value": float(conds["discount_pct"]),
                         "bonus_items": []}
                return True, f"Time: {dow} {cur}", r

    elif rtype == "seasonal":
        start = conds.get("start_date")
        end   = conds.get("end_date")
        if start and end:
            try:
                if date.fromisoformat(start) <= today <= date.fromisoformat(end):
                    return True, f"Seasonal: {rule.get('rule_name', '')}", reward
            except ValueError:
                pass

    elif rtype == "lifetime_value":
        min_ltv    = float(conds.get("min_lifetime_value", 0))
        actual_ltv = float(metrics.get("total_lifetime_value", 0))
        if actual_ltv >= min_ltv:
            return True, f"LTV ৳{actual_ltv:.0f} ≥ ৳{min_ltv:.0f}", reward

    return False, "", {}


# ── Reward Helpers ────────────────────────────────────────────

def _extract_reward(r: dict) -> tuple[str, float, list]:
    rtype = r.get("reward_type", "percentage")
    val   = float(r.get("discount_value", 0))
    items = r.get("bonus_items") or []
    return rtype, val, items


def _compute_amount(reward: dict, cart_amount: float) -> float:
    rtype, val, _ = _extract_reward(reward)
    if rtype == "percentage":
        return round(cart_amount * val / 100, 2)
    if rtype == "flat":
        return round(val, 2)
    return 0.0


def _build_message(reward: dict, discount_amount: float) -> str:
    rtype, val, bonus_items = _extract_reward(reward)
    if rtype == "bonus" and bonus_items:
        s = ", ".join(f"{b.get('name','')} ×{b.get('quantity',1)}" for b in bonus_items[:3])
        return f"ফ্রি পাচ্ছেন: {s}"
    if rtype == "percentage" and val > 0:
        return f"আপনি {val:.0f}% ছাড় পাচ্ছেন!"
    if rtype == "flat" and val > 0:
        return f"আপনি ৳{val:.0f} ছাড় পাচ্ছেন!"
    if rtype == "free_delivery":
        return "ফ্রি ডেলিভারি পাচ্ছেন!"
    return ""


def _get_cfg(tenant_id: str) -> dict:
    try:
        res = (supabase.table("ai_config")
               .select("conflict_resolution, discount_stack_cap")
               .eq("tenant_id", tenant_id)
               .maybe_single()
               .execute())
        return res.data or {}
    except Exception:
        return {}


# ── Conflict Resolution ───────────────────────────────────────

def _resolve(matched: list, resolution: str, stack_cap: float, cart_amount: float) -> tuple[list, float]:
    """Returns (applied_list, total_discount_amount). applied_list has ≥1 items."""
    if not matched:
        return [], 0.0

    # Always sort by priority first (lower = higher priority), then by discount amount desc
    by_priority = sorted(matched, key=lambda m: (m.get("priority", 99), -m.get("discount_amount", 0.0)))

    if resolution == "priority_wins":
        w = by_priority[0]
        return [w], round(w.get("discount_amount", 0.0), 2)

    if resolution == "best_deal":
        w = max(by_priority, key=lambda m: m.get("discount_amount", 0.0))
        return [w], round(w.get("discount_amount", 0.0), 2)

    if resolution == "stack_all":
        total = round(sum(m.get("discount_amount", 0.0) for m in by_priority), 2)
        return by_priority, total

    if resolution == "stack_with_cap":
        cap_amount = cart_amount * stack_cap / 100
        applied: list = []
        total = 0.0
        for m in by_priority:
            if total >= cap_amount:
                break
            disc = min(m.get("discount_amount", 0.0), cap_amount - total)
            if disc > 0:
                mc = dict(m)
                mc["discount_amount"] = round(disc, 2)
                applied.append(mc)
                total += disc
        return applied, round(total, 2)

    # default: priority_wins
    w = by_priority[0]
    return [w], round(w.get("discount_amount", 0.0), 2)


# ── Empty Context ─────────────────────────────────────────────

def _empty_ctx(metrics: dict) -> dict:
    return {
        "customer_metrics":    metrics,
        "matched_discounts":   [],
        "applied_discount":    None,
        "applied_discounts":   [],
        "discount_code":       None,
        "discount_id":         None,
        "discount_name":       None,
        "rule_id":             None,
        "rule_name":           None,
        "rule_type":           None,
        "reward":              {},
        "reward_type":         "percentage",
        "discount_amount":     0.0,
        "final_price":         0.0,
        "bonus_items":         [],
        "discount_message":    "",
        "resolution":          "best_deal",
        "final_discount_pct":  0.0,
        "final_discount_flat": 0.0,
        "applied_rules":       [],
    }


# ── Main Entry Point ──────────────────────────────────────────

def get_discount_context(
    tenant_id: str,
    customer_platform_id: Optional[str] = None,
    customer_phone: Optional[str] = None,
    cart_context: Optional[dict] = None,
) -> dict:
    logger.info(f"[DiscountEngine v3] START tenant={tenant_id} cart={cart_context}")

    metrics     = get_customer_metrics(tenant_id, customer_platform_id, customer_phone)
    now_utc     = datetime.now(timezone.utc)
    ctx         = cart_context or {}
    cart_amount = float(ctx.get("cart_amount", 0))

    # 1. Fetch active discounts within effective window
    try:
        raw = (
            supabase.table("discounts")
            .select("*")
            .eq("tenant_id", tenant_id)
            .eq("is_active", True)
            .lte("effective_from", now_utc.isoformat())
            .execute().data or []
        )
    except Exception as e:
        logger.warning(f"[DiscountEngine] discounts fetch: {e}")
        return _empty_ctx(metrics)

    active = []
    for d in raw:
        eff_to = d.get("effective_to")
        if not eff_to:
            active.append(d)
        else:
            try:
                eto = datetime.fromisoformat(eff_to.replace("Z", "+00:00")).astimezone(timezone.utc)
                if eto >= now_utc:
                    active.append(d)
            except Exception:
                active.append(d)

    if not active:
        logger.info("[DiscountEngine] No active discounts")
        return _empty_ctx(metrics)

    # 2. Fetch all rule_ids referenced by active discounts
    all_rule_ids = list({str(rid) for d in active for rid in (d.get("rule_ids") or [])})
    if not all_rule_ids:
        return _empty_ctx(metrics)

    try:
        rules_data = (
            supabase.table("discount_rules")
            .select("*")
            .eq("tenant_id", tenant_id)
            .in_("rule_id", all_rule_ids)
            .execute().data or []
        )
    except Exception as e:
        logger.warning(f"[DiscountEngine] rules fetch: {e}")
        return _empty_ctx(metrics)

    rules_map = {str(r["rule_id"]): r for r in rules_data}

    # 3. Check each discount — first matching rule wins
    matched = []
    for discount in active:
        rule_ids = [str(r) for r in (discount.get("rule_ids") or [])]
        for rid in rule_ids:
            rule = rules_map.get(rid)
            if not rule:
                continue
            hit, reason, reward = _check_single_rule(rule, metrics, ctx)
            if hit:
                rtype, val, bonus_items = _extract_reward(reward)
                disc_amount = _compute_amount(reward, cart_amount)
                matched.append({
                    "discount_id":      discount["discount_id"],
                    "discount_code":    discount["discount_code"],
                    "discount_name":    discount.get("discount_name", ""),
                    "priority":         int(discount.get("priority") or 99),
                    "rule_id":          rid,
                    "rule_name":        rule.get("rule_name", ""),
                    "rule_type":        rule["rule_type"],
                    "reward":           reward,
                    "reward_type":      rtype,
                    "discount_value":   val,
                    "bonus_items":      bonus_items,
                    "discount_amount":  disc_amount,
                    "reason":           reason,
                })
                logger.info(
                    f"[DiscountEngine] Matched '{discount.get('discount_name')}' "
                    f"via rule '{rule.get('rule_name')}' | {reason}"
                )
                break

    if not matched:
        logger.info("[DiscountEngine] No rules matched")
        return _empty_ctx(metrics)

    # 4. Conflict resolution
    cfg        = _get_cfg(tenant_id)
    resolution = cfg.get("conflict_resolution", "best_deal")
    stack_cap  = float(cfg.get("discount_stack_cap", 30))

    applied_list, total_discount = _resolve(matched, resolution, stack_cap, cart_amount)
    if not applied_list:
        logger.info("[DiscountEngine] Resolve produced no applied discounts")
        return _empty_ctx(metrics)

    applied         = applied_list[0]
    discount_amount = total_discount
    final_price     = max(0.0, cart_amount - discount_amount) if cart_amount > 0 else 0.0
    reward          = applied.get("reward", {})
    rtype           = applied.get("reward_type", "percentage")

    # Build discount message
    if len(applied_list) > 1:
        disc_msg = (
            f"আপনার অর্ডারে {len(applied_list)}টি ছাড় একসাথে প্রযোজ্য! "
            f"মোট ছাড়: ৳{discount_amount:.0f}"
        )
    else:
        disc_msg = _build_message(reward, discount_amount)

    logger.info(
        f"[DiscountEngine] Applied {len(applied_list)} discount(s): "
        f"primary='{applied.get('discount_name')}' code={applied.get('discount_code')} "
        f"total=৳{discount_amount:.2f} resolution={resolution}"
    )

    return {
        "customer_metrics":    metrics,
        "matched_discounts":   matched,
        "applied_discount":    applied,
        "applied_discounts":   applied_list,
        "discount_code":       applied.get("discount_code"),
        "discount_id":         applied.get("discount_id"),
        "discount_name":       applied.get("discount_name"),
        "rule_id":             applied.get("rule_id"),
        "rule_name":           applied.get("rule_name"),
        "rule_type":           applied.get("rule_type"),
        "reward":              reward,
        "reward_type":         rtype,
        "discount_amount":     round(discount_amount, 2),
        "final_price":         round(final_price, 2),
        "bonus_items":         applied.get("bonus_items") or [],
        "discount_message":    disc_msg,
        "resolution":          resolution,
        # Backward-compat fields
        "final_discount_pct":  applied.get("discount_value", 0) if rtype == "percentage" else 0,
        "final_discount_flat": applied.get("discount_value", 0) if rtype == "flat" else 0,
        "applied_rules":       applied_list,
    }
