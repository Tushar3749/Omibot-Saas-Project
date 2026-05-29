"""
OmniBot SaaS — Analytics Router
Dashboard statistics: messages, conversations, orders, revenue, advanced metrics.
"""
import logging
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends
from app.auth.dependencies import get_current_tenant
from app.database import supabase

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/overview")
async def get_overview(tenant: dict = Depends(get_current_tenant)):
    tid = tenant["tenant_id"]
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    conv_res = (
        supabase.table("conversations")
        .select("conversation_id", count="exact")
        .eq("tenant_id", tid)
        .execute()
    )
    msg_res = (
        supabase.table("messages")
        .select("message_id", count="exact")
        .eq("tenant_id", tid)
        .execute()
    )
    msg_month_res = (
        supabase.table("messages")
        .select("message_id", count="exact")
        .eq("tenant_id", tid)
        .gte("created_at", month_start.isoformat())
        .execute()
    )
    order_res = (
        supabase.table("orders")
        .select("order_id, agreed_price, status, product_name")
        .eq("tenant_id", tid)
        .execute()
    )
    orders = order_res.data or []
    total_orders = len(orders)
    revenue = sum(
        float(o.get("agreed_price") or 0)
        for o in orders
        if o.get("status") in ("confirmed", "delivered")
    )

    product_counts: dict = {}
    for o in orders:
        pname = o.get("product_name", "Unknown")
        product_counts[pname] = product_counts.get(pname, 0) + 1

    top_products = [
        {"name": k, "count": v}
        for k, v in sorted(product_counts.items(), key=lambda x: -x[1])[:10]
    ]

    return {
        "total_conversations": conv_res.count or 0,
        "total_messages": msg_res.count or 0,
        "messages_this_month": msg_month_res.count or 0,
        "total_orders": total_orders,
        "revenue_total": revenue,
        "top_products": top_products,
    }


@router.get("/daily")
async def get_daily_stats(days: int = 30, tenant: dict = Depends(get_current_tenant)):
    tid   = tenant["tenant_id"]
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    msgs_res = (
        supabase.table("messages")
        .select("created_at")
        .eq("tenant_id", tid)
        .gte("created_at", since)
        .execute()
    )
    orders_res = (
        supabase.table("orders")
        .select("created_at, agreed_price, status")
        .eq("tenant_id", tid)
        .gte("created_at", since)
        .execute()
    )

    msg_by_date: dict = {}
    for m in (msgs_res.data or []):
        d = m["created_at"][:10]
        msg_by_date[d] = msg_by_date.get(d, 0) + 1

    order_by_date: dict = {}
    revenue_by_date: dict = {}
    for o in (orders_res.data or []):
        d = o["created_at"][:10]
        order_by_date[d] = order_by_date.get(d, 0) + 1
        if o.get("status") in ("confirmed", "delivered"):
            revenue_by_date[d] = revenue_by_date.get(d, 0.0) + float(o.get("agreed_price") or 0)

    result = []
    for i in range(days - 1, -1, -1):
        day = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
        result.append({
            "date":     day,
            "messages": msg_by_date.get(day, 0),
            "orders":   order_by_date.get(day, 0),
            "revenue":  round(revenue_by_date.get(day, 0.0), 2),
        })

    return result


@router.get("/advanced")
async def get_advanced_analytics(
    period: str = "30d",
    tenant: dict = Depends(get_current_tenant),
):
    """Comprehensive analytics: revenue chart, top products, funnel, peak hours, retention."""
    tid = tenant["tenant_id"]

    days_map = {"7d": 7, "30d": 30, "90d": 90}
    days  = days_map.get(period, 30)
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    # ── Fetch raw data ────────────────────────────────────────────────────────
    orders_res = (
        supabase.table("orders")
        .select("order_id, customer_id, product_name, agreed_price, status, created_at")
        .eq("tenant_id", tid)
        .gte("created_at", since)
        .execute()
    )
    orders_all_res = (
        supabase.table("orders")
        .select("customer_id, status")
        .eq("tenant_id", tid)
        .execute()
    )
    convs_res = (
        supabase.table("conversations")
        .select("conversation_id, customer_id, created_at")
        .eq("tenant_id", tid)
        .execute()
    )
    msgs_res = (
        supabase.table("messages")
        .select("created_at, role, content")
        .eq("tenant_id", tid)
        .gte("created_at", since)
        .execute()
    )

    orders    = orders_res.data or []
    orders_all = orders_all_res.data or []
    convs     = convs_res.data or []
    messages  = msgs_res.data or []

    # ── Revenue chart (group by date) ────────────────────────────────────────
    revenue_by_date: dict = defaultdict(float)
    orders_by_date:  dict = defaultdict(int)
    for o in orders:
        d = o["created_at"][:10]
        orders_by_date[d] += 1
        if o.get("status") in ("confirmed", "delivered"):
            revenue_by_date[d] += float(o.get("agreed_price") or 0)

    revenue_chart = []
    for i in range(days - 1, -1, -1):
        day = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
        revenue_chart.append({
            "date":    day,
            "revenue": round(revenue_by_date.get(day, 0.0), 2),
            "orders":  orders_by_date.get(day, 0),
        })

    # ── Top 10 products ───────────────────────────────────────────────────────
    prod_count:   dict = defaultdict(int)
    prod_revenue: dict = defaultdict(float)
    for o in orders:
        pname = o.get("product_name") or "Unknown"
        prod_count[pname] += 1
        if o.get("status") in ("confirmed", "delivered"):
            prod_revenue[pname] += float(o.get("agreed_price") or 0)

    top_products = sorted(
        [{"name": k, "count": prod_count[k], "revenue": round(prod_revenue[k], 2)} for k in prod_count],
        key=lambda x: -x["count"]
    )[:10]

    # ── Average Order Value ───────────────────────────────────────────────────
    paid_orders = [o for o in orders if o.get("status") in ("confirmed", "delivered")]
    total_revenue = sum(float(o.get("agreed_price") or 0) for o in paid_orders)
    avg_order_value = round(total_revenue / len(paid_orders), 2) if paid_orders else 0.0

    # ── Conversion Funnel ─────────────────────────────────────────────────────
    total_convs  = len(convs)
    total_orders_cnt = len(orders_all)
    delivered_cnt = sum(1 for o in orders_all if o.get("status") in ("confirmed", "delivered"))

    conversion_funnel = {
        "conversations": total_convs,
        "orders":        total_orders_cnt,
        "delivered":     delivered_cnt,
        "conv_to_order": round((total_orders_cnt / total_convs * 100), 1) if total_convs else 0,
        "order_to_paid": round((delivered_cnt / total_orders_cnt * 100), 1) if total_orders_cnt else 0,
    }

    # ── Peak Hours (by message count) ─────────────────────────────────────────
    hour_counts: dict = defaultdict(int)
    for m in messages:
        if m.get("role") == "user":
            try:
                hour = int(m["created_at"][11:13])
                hour_counts[hour] += 1
            except Exception:
                pass

    peak_hours = [{"hour": h, "count": hour_counts.get(h, 0)} for h in range(24)]

    # ── New vs Returning Customers ────────────────────────────────────────────
    # Customers with more than 1 order are "returning"
    customer_order_counts: dict = defaultdict(int)
    for o in orders_all:
        cid = o.get("customer_id")
        if cid:
            customer_order_counts[cid] += 1

    returning = sum(1 for cnt in customer_order_counts.values() if cnt > 1)
    new_customers = sum(1 for cnt in customer_order_counts.values() if cnt == 1)
    total_cust = len(customer_order_counts)

    new_vs_returning = {
        "new":       new_customers,
        "returning": returning,
        "total":     total_cust,
        "retention_rate": round((returning / total_cust * 100), 1) if total_cust else 0,
    }

    # ── Popular Questions (customer message keywords) ─────────────────────────
    keyword_counts: dict = defaultdict(int)
    question_keywords = ["দাম", "price", "কত", "stock", "available", "deliver",
                         "ডেলিভারি", "payment", "পেমেন্ট", "return", "রিটার্ন",
                         "offer", "অফার", "discount", "ছাড়"]
    for m in messages:
        if m.get("role") == "user":
            content = (m.get("content") or "").lower()
            for kw in question_keywords:
                if kw in content:
                    keyword_counts[kw] += 1

    popular_questions = sorted(
        [{"keyword": k, "count": v} for k, v in keyword_counts.items()],
        key=lambda x: -x["count"]
    )[:10]

    return {
        "period":            period,
        "revenue_chart":     revenue_chart,
        "top_products":      top_products,
        "avg_order_value":   avg_order_value,
        "total_revenue":     round(total_revenue, 2),
        "conversion_funnel": conversion_funnel,
        "peak_hours":        peak_hours,
        "new_vs_returning":  new_vs_returning,
        "popular_questions": popular_questions,
    }
