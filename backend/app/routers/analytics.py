"""
OmniBot SaaS — Analytics Router
Dashboard statistics: messages, conversations, orders, revenue.
"""
import logging
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

    # Total conversations
    conv_res = (
        supabase.table("conversations")
        .select("conversation_id", count="exact")
        .eq("tenant_id", tid)
        .execute()
    )

    # Total messages
    msg_res = (
        supabase.table("messages")
        .select("message_id", count="exact")
        .eq("tenant_id", tid)
        .execute()
    )

    # Messages this month
    msg_month_res = (
        supabase.table("messages")
        .select("message_id", count="exact")
        .eq("tenant_id", tid)
        .gte("created_at", month_start.isoformat())
        .execute()
    )

    # Total orders
    order_res = (
        supabase.table("orders")
        .select("order_id, agreed_price, status")
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

    # Top products from orders
    product_counts: dict = {}
    for o in orders:
        pname = o.get("product_name", "Unknown")
        product_counts[pname] = product_counts.get(pname, 0) + 1

    top_products = [
        {"name": k, "count": v}
        for k, v in sorted(product_counts.items(), key=lambda x: -x[1])[:5]
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
    """Return per-day message and order counts for the last `days` days."""
    tid  = tenant["tenant_id"]
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
        .select("created_at")
        .eq("tenant_id", tid)
        .gte("created_at", since)
        .execute()
    )

    # Aggregate by date
    msg_by_date: dict = {}
    for m in (msgs_res.data or []):
        d = m["created_at"][:10]
        msg_by_date[d] = msg_by_date.get(d, 0) + 1

    order_by_date: dict = {}
    for o in (orders_res.data or []):
        d = o["created_at"][:10]
        order_by_date[d] = order_by_date.get(d, 0) + 1

    # Build last-N-days list
    result = []
    for i in range(days - 1, -1, -1):
        day = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
        result.append({
            "date":   day,
            "messages": msg_by_date.get(day, 0),
            "orders":   order_by_date.get(day, 0),
        })

    return result
