"""
OmniBot SaaS — Courier Router
Pathao and Steadfast order creation + tracking number management.
"""
import logging
import httpx
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import TrackingUpdate, CourierOrderCreate

logger = logging.getLogger(__name__)
router = APIRouter()

PATHAO_BASE   = "https://hermes.pathao.com/api/v1"
STEADFAST_BASE = "https://portal.steadfast.com.bd/public/api/v1"


def _get_ai_config(tenant_id: str) -> dict:
    result = (
        supabase.table("ai_config")
        .select("*")
        .eq("tenant_id", tenant_id)
        .maybe_single()
        .execute()
    )
    return result.data or {}


async def _pathao_token(client_id: str, client_secret: str) -> str:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{PATHAO_BASE}/issue-token",
            json={
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "client_credentials",
            },
        )
        resp.raise_for_status()
        return resp.json().get("access_token", "")


# ── Save tracking number manually ─────────────────────────────────────────────

@router.patch("/orders/{order_id}/tracking")
async def save_tracking(
    order_id: str,
    body: TrackingUpdate,
    tenant: dict = Depends(get_current_tenant),
):
    result = (
        supabase.table("orders")
        .update({
            "tracking_number": body.tracking_number,
            "courier_name": body.courier_name,
        })
        .eq("order_id", order_id)
        .eq("tenant_id", tenant["tenant_id"])
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Order not found")
    return result.data[0]


# ── Create Steadfast shipment ──────────────────────────────────────────────────

@router.post("/steadfast/create")
async def create_steadfast_order(
    body: CourierOrderCreate,
    tenant: dict = Depends(get_current_tenant),
):
    tid = tenant["tenant_id"]
    cfg = _get_ai_config(tid)
    api_key    = cfg.get("steadfast_api_key")
    api_secret = cfg.get("steadfast_api_secret")

    if not api_key or not api_secret:
        raise HTTPException(
            status_code=400,
            detail="Steadfast API credentials not configured. Go to AI Settings → বাংলাদেশ Settings."
        )

    order = supabase.table("orders").select("*").eq("order_id", body.order_id).eq("tenant_id", tid).maybe_single().execute()
    if not order.data:
        raise HTTPException(status_code=404, detail="Order not found")

    payload = {
        "invoice": body.order_id[:20],
        "recipient_name": body.recipient_name,
        "recipient_phone": body.recipient_phone,
        "recipient_address": body.recipient_address,
        "cod_amount": body.cod_amount,
        "note": body.note or "",
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{STEADFAST_BASE}/create_order",
                json=payload,
                headers={"Api-Key": api_key, "Secret-Key": api_secret, "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Steadfast error: {e.response.text}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Steadfast unreachable: {str(e)}")

    consignment_id = data.get("consignment", {}).get("consignment_id") or data.get("consignment_id")
    tracking_code  = data.get("consignment", {}).get("tracking_code") or str(consignment_id)

    if consignment_id:
        supabase.table("orders").update({
            "tracking_number": tracking_code,
            "courier_name": "steadfast",
        }).eq("order_id", body.order_id).execute()

    return {"consignment_id": consignment_id, "tracking_code": tracking_code, "raw": data}


# ── Create Pathao shipment ─────────────────────────────────────────────────────

@router.post("/pathao/create")
async def create_pathao_order(
    body: CourierOrderCreate,
    tenant: dict = Depends(get_current_tenant),
):
    tid = tenant["tenant_id"]
    cfg = _get_ai_config(tid)
    client_id     = cfg.get("pathao_client_id")
    client_secret = cfg.get("pathao_client_secret")
    store_id      = cfg.get("pathao_store_id")

    if not client_id or not client_secret or not store_id:
        raise HTTPException(
            status_code=400,
            detail="Pathao credentials not configured. Go to AI Settings → বাংলাদেশ Settings."
        )

    order = supabase.table("orders").select("*").eq("order_id", body.order_id).eq("tenant_id", tid).maybe_single().execute()
    if not order.data:
        raise HTTPException(status_code=404, detail="Order not found")

    try:
        token = await _pathao_token(client_id, client_secret)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Pathao auth failed: {str(e)}")

    payload = {
        "store_id": int(store_id),
        "merchant_order_id": body.order_id[:30],
        "recipient_name": body.recipient_name,
        "recipient_phone": body.recipient_phone,
        "recipient_address": body.recipient_address,
        "recipient_city": body.recipient_city,
        "recipient_zone": body.recipient_city,
        "delivery_type": 48,
        "item_type": 2,
        "special_instruction": body.note or "",
        "item_quantity": 1,
        "item_weight": 0.5,
        "item_description": "Product",
        "amount_to_collect": body.cod_amount,
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{PATHAO_BASE}/orders",
                json=payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Pathao error: {e.response.text}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Pathao unreachable: {str(e)}")

    consignment_id = data.get("data", {}).get("consignment_id") or data.get("consignment_id")
    tracking_code  = str(consignment_id) if consignment_id else ""

    if consignment_id:
        supabase.table("orders").update({
            "tracking_number": tracking_code,
            "courier_name": "pathao",
        }).eq("order_id", body.order_id).execute()

    return {"consignment_id": consignment_id, "tracking_code": tracking_code, "raw": data}


# ── Track order ───────────────────────────────────────────────────────────────

@router.get("/track/{order_id}")
async def track_order(
    order_id: str,
    tenant: dict = Depends(get_current_tenant),
):
    tid = tenant["tenant_id"]
    order_res = (
        supabase.table("orders")
        .select("order_id, tracking_number, courier_name, status")
        .eq("order_id", order_id)
        .eq("tenant_id", tid)
        .maybe_single()
        .execute()
    )
    if not order_res.data:
        raise HTTPException(status_code=404, detail="Order not found")

    order = order_res.data
    tracking = order.get("tracking_number")
    courier  = order.get("courier_name")

    if not tracking:
        return {"order_id": order_id, "status": order.get("status"), "tracking": None, "courier": courier}

    cfg = _get_ai_config(tid)

    if courier == "steadfast":
        api_key    = cfg.get("steadfast_api_key")
        api_secret = cfg.get("steadfast_api_secret")
        if api_key and api_secret:
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.get(
                        f"{STEADFAST_BASE}/status_by_invoice/{tracking}",
                        headers={"Api-Key": api_key, "Secret-Key": api_secret},
                    )
                    if resp.status_code == 200:
                        return {"order_id": order_id, "courier": "steadfast", "tracking": tracking, "data": resp.json()}
            except Exception:
                pass

    if courier == "pathao":
        client_id     = cfg.get("pathao_client_id")
        client_secret = cfg.get("pathao_client_secret")
        if client_id and client_secret:
            try:
                token = await _pathao_token(client_id, client_secret)
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.get(
                        f"{PATHAO_BASE}/orders/{tracking}/info",
                        headers={"Authorization": f"Bearer {token}"},
                    )
                    if resp.status_code == 200:
                        return {"order_id": order_id, "courier": "pathao", "tracking": tracking, "data": resp.json()}
            except Exception:
                pass

    return {"order_id": order_id, "courier": courier, "tracking": tracking, "data": None}
