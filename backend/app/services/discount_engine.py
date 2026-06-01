"""
OmniBot SaaS — Discount Engine v2
Pipeline:
  1. get_customer_metrics   — query orders table for lifetime stats
  2. match_rules            — check all active discount rules (reward JSONB: reward_type/discount_value/bonus_items)
  3. _match_campaigns       — check active campaigns (reward JSONB)
  4. apply_conflict_resolution — best_deal / priority_wins / stack_all / stack_with_cap
  5. get_discount_context   — full pipeline, returns dict ready for Gemini injection

reward JSONB shape (all rule types):
  {"reward_type": "percentage|flat|bonus|free_delivery", "discount_value": N, "bonus_items": [...]}

Combos are NOT part of the discount engine — they are separate product bundles.
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
                  .select("product_id, category")
                  .in_("product_id", product_ids)
                  .execute())
            previous_categories = list({p["category"] for p in (pr.data or []) if p.get("category")})
        except Exception:
            pass

    today = date.today()
    current_month_prefix = f"{today.year}-{today.month:02d}"
    current_month_orders = sum(
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


# ── Reward Extraction ─────────────────────────────────────────────────────────

def _extract_reward(reward_dict: dict) -> tuple[str, float, list]:
    """Return (reward_type, discount_value, bonus_items) from a reward JSONB dict."""
    # New format: reward_type; old format fallback: discount_type
    rtype = reward_dict.get("reward_type") or reward_dict.get("discount_type", "percentage")
    val   = float(reward_dict.get("discount_value", 0))
    items = reward_dict.get("bonus_items") or []
    return rtype, val, items


# ── Campaign Matching ─────────────────────────────────────────────────────────

def _match_campaigns(tenant_id: str, type_priority: int) -> list[dict]:
    today = date.today()
    matched = []
    try:
        campaigns = (
            supabase.table("campaigns")
            .select("campaign_id, name, reward, type, amount, start_date, end_date")
            .eq("tenant_id", tenant_id)
            .eq("is_active", True)
            .execute()
        ).data or []
    except Exception as e:
        logger.warning(f"Campaign fetch error: {e}")
        return []

    logger.info(f"  Campaigns: {len(campaigns)} active found")

    for c in campaigns:
        start = c.get("start_date")
        end   = c.get("end_date")
        try:
            if start and today < date.fromisoformat(str(start)[:10]):
                continue
            if end and today > date.fromisoformat(str(end)[:10]):
                continue
        except ValueError:
            pass

        # Read from reward JSONB (new), fall back to type/amount (legacy)
        reward_dict = c.get("reward") or {}
        if reward_dict:
            rtype, val, bonus_items = _extract_reward(reward_dict)
        else:
            rtype = c.get("type", "percentage")
            val   = float(c.get("amount") or 0)
            bonus_items = []

        if rtype != "bonus" and val <= 0:
            continue

        matched.append({
            "rule_id":        c["campaign_id"],
            "rule_name":      c["name"],
            "rule_type":      "campaign",
            "priority":       type_priority,
            "discount_type":  rtype,
            "discount_value": val,
            "bonus_items":    bonus_items,
            "reason":         f"Campaign: {c['name']}",
        })
        logger.info(f"  ✓ Campaign matched: '{c['name']}' → {rtype} {val}")

    return matched


# ── Rule Matching ─────────────────────────────────────────────────────────────

def match_rules(
    tenant_id: str,
    metrics: dict,
    cart_context: Optional[dict] = None,
    enabled_type_keys: Optional[set] = None,
) -> list[dict]:
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

    logger.info(f"  Discount rules: {len(rules)} active fetched")

    ctx          = cart_context or {}
    cart_amount  = float(ctx.get("cart_amount", 0))
    product_skus = list(ctx.get("product_skus") or [])
    categories   = list(ctx.get("categories") or [])
    district     = ctx.get("district")
    quantity     = int(ctx.get("quantity") or 1)

    today  = date.today()
    now_dt = datetime.now()

    matched = []

    for rule in rules:
        rtype = rule["rule_type"]

        if enabled_type_keys is not None and rtype not in enabled_type_keys:
            continue

        conds       = rule.get("conditions") or {}
        reward_dict = dict(rule.get("reward") or {})
        hit         = False
        reason      = ""
        # Default reward (may be overridden per-tier for repeated_customer)
        curr_reward = reward_dict

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
                        # Per-tier reward: prefer tier.reward, fall back to tier.discount_pct
                        if tier.get("reward"):
                            curr_reward = tier["reward"]
                        elif tier.get("discount_pct"):
                            curr_reward = {"reward_type": "percentage", "discount_value": float(tier["discount_pct"]), "bonus_items": []}
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
                # Fall back to conditions.discount_pct if reward is empty (legacy)
                if not curr_reward.get("reward_type") and conds.get("discount_pct"):
                    curr_reward = {"reward_type": "percentage", "discount_value": float(conds["discount_pct"]), "bonus_items": []}

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
                    if not curr_reward.get("reward_type") and conds.get("discount_pct"):
                        curr_reward = {"reward_type": "percentage", "discount_value": float(conds["discount_pct"]), "bonus_items": []}

        # ── 9. Seasonal ────────────────────────────────────────────────────────
        elif rtype == "seasonal":
            start = conds.get("start_date")
            end   = conds.get("end_date")
            if start and end:
                try:
                    if date.fromisoformat(start) <= today <= date.fromisoformat(end):
                        hit    = True
                        reason = f"Seasonal: {rule.get('rule_name', 'Sale')}"
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
            rwd_type, disc_val, bonus_items = _extract_reward(curr_reward)
            matched.append({
                "rule_id":        rule["rule_id"],
                "rule_name":      rule["rule_name"] or rtype,
                "rule_type":      rtype,
                "priority":       rule["priority"],
                "discount_type":  rwd_type,
                "discount_value": disc_val,
                "bonus_items":    bonus_items,
                "reason":         reason,
            })
            logger.info(
                f"  ✓ Rule matched: '{rule['rule_name'] or rtype}' "
                f"({rtype}) p={rule['priority']} → {rwd_type} {disc_val} | {reason}"
            )

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
    Bonus and free_delivery rules are always included in applied_rules
    but are excluded from pct/flat computation.
    """
    if not matched:
        return 0.0, 0.0, []

    bonus_rules    = [r for r in matched if r.get("discount_type") in ("bonus", "free_delivery")]
    monetary_rules = [r for r in matched if r.get("discount_type") not in ("bonus", "free_delivery")]

    if resolution == "priority_wins":
        if monetary_rules:
            top = monetary_rules[0]
            logger.info(f"  conflict=priority_wins → applying: '{top['rule_name']}'")
            if top["discount_type"] == "percentage":
                return float(top["discount_value"]), 0.0, [top] + bonus_rules
            return 0.0, float(top["discount_value"]), [top] + bonus_rules
        return 0.0, 0.0, bonus_rules

    if resolution == "best_deal":
        if monetary_rules:
            best = max(monetary_rules, key=lambda r: (
                r["discount_value"] * cart_amount / 100
                if r["discount_type"] == "percentage"
                else r["discount_value"]
            ))
            logger.info(f"  conflict=best_deal → applying: '{best['rule_name']}'")
            if best["discount_type"] == "percentage":
                return float(best["discount_value"]), 0.0, [best] + bonus_rules
            return 0.0, float(best["discount_value"]), [best] + bonus_rules
        return 0.0, 0.0, bonus_rules

    # stack_all or stack_with_cap
    total_pct  = sum(r["discount_value"] for r in monetary_rules if r["discount_type"] == "percentage")
    total_flat = sum(r["discount_value"] for r in monetary_rules if r["discount_type"] == "flat")

    if resolution == "stack_with_cap":
        total_pct = min(total_pct, stack_cap)

    return total_pct, total_flat, monetary_rules + bonus_rules


# ── Main Entry Point ──────────────────────────────────────────────────────────

def get_discount_context(
    tenant_id: str,
    customer_platform_id: Optional[str] = None,
    customer_phone: Optional[str] = None,
    cart_context: Optional[dict] = None,
) -> dict:
    logger.info(
        f"[DiscountEngine] START tenant={tenant_id} "
        f"psid={'***' if customer_platform_id else '-'} "
        f"phone={'***' if customer_phone else '-'} "
        f"cart={cart_context}"
    )

    metrics = get_customer_metrics(tenant_id, customer_platform_id, customer_phone)
    logger.info(
        f"[DiscountEngine] Metrics: new={metrics['is_new_customer']} "
        f"orders={metrics['total_orders']} ltv=৳{metrics['total_lifetime_value']}"
    )

    resolution        = "best_deal"
    stack_cap         = 30.0
    priority_settings: dict = {}
    try:
        cfg = (supabase.table("ai_config")
               .select("conflict_resolution, discount_stack_cap, discount_priority_settings")
               .eq("tenant_id", tenant_id)
               .maybe_single()
               .execute())
        if cfg and cfg.data:
            resolution        = cfg.data.get("conflict_resolution") or "best_deal"
            stack_cap         = float(cfg.data.get("discount_stack_cap") or 30)
            priority_settings = cfg.data.get("discount_priority_settings") or {}
    except Exception as e:
        logger.warning(f"[DiscountEngine] Config fetch error: {e}")

    enabled_type_keys: Optional[set] = None
    campaign_priority = 1

    if priority_settings:
        enabled_type_keys = {
            key for key, val in priority_settings.items()
            if isinstance(val, dict) and val.get("enabled", True)
        }
        cp = priority_settings.get("campaign", {})
        if isinstance(cp, dict):
            campaign_priority = int(cp.get("priority", 1))

    matched = match_rules(tenant_id, metrics, cart_context, enabled_type_keys)

    campaign_on = enabled_type_keys is None or "campaign" in enabled_type_keys
    if campaign_on:
        cam = _match_campaigns(tenant_id, campaign_priority)
        matched.extend(cam)

    matched.sort(key=lambda r: r["priority"])
    logger.info(f"[DiscountEngine] Total matched: {len(matched)}")

    cart_amount = float((cart_context or {}).get("cart_amount", 0))
    final_pct, final_flat, applied = apply_conflict_resolution(
        matched, resolution, stack_cap, cart_amount
    )

    # Collect all bonus items from applied rules
    all_bonus_items: list = []
    for r in applied:
        if r.get("discount_type") in ("bonus", "free_delivery"):
            all_bonus_items.extend(r.get("bonus_items") or [])

    discount_message = ""
    if all_bonus_items:
        items_str = ", ".join(
            f"{item.get('name', '')} ×{item.get('quantity', 1)}"
            for item in all_bonus_items[:3]
        )
        discount_message = f"ফ্রি পাচ্ছেন: {items_str}"
    elif final_pct > 0:
        reasons = "; ".join(r["reason"] for r in applied[:2] if r.get("reason"))
        discount_message = f"আপনি {final_pct:.0f}% ছাড় পাচ্ছেন! ({reasons})"
    elif final_flat > 0:
        discount_message = f"আপনি ৳{final_flat:.0f} ছাড় পাচ্ছেন!"

    discount_amount = (cart_amount * final_pct / 100) + final_flat if cart_amount > 0 else 0.0
    final_price     = max(0.0, cart_amount - discount_amount) if cart_amount > 0 else 0.0

    logger.info(
        f"[DiscountEngine] RESULT: {discount_message or 'no discount'} | "
        f"discount_amount=৳{discount_amount:.2f} final_price=৳{final_price:.2f}"
    )

    return {
        "customer_metrics":    metrics,
        "matched_rules":       matched,
        "applied_rules":       applied,
        "final_discount_pct":  round(final_pct, 2),
        "final_discount_flat": round(final_flat, 2),
        "discount_amount":     round(discount_amount, 2),
        "final_price":         round(final_price, 2),
        "bonus_items":         all_bonus_items,
        "discount_message":    discount_message,
        "resolution":          resolution,
    }
