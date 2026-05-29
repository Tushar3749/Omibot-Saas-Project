"""
OmniBot SaaS — Returns / Damage / Expiry Router
"""
import uuid, logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import ReturnCreate, ReturnStatusUpdate

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/")
async def list_returns(tenant: dict = Depends(get_current_tenant)):
    result = (
        supabase.table("returns")
        .select("*")
        .eq("tenant_id", tenant["tenant_id"])
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


@router.post("/", status_code=201)
async def create_return(body: ReturnCreate, tenant: dict = Depends(get_current_tenant)):
    tid = tenant["tenant_id"]

    # Find product by SKU
    product = (
        supabase.table("products")
        .select("product_id,sku,stock")
        .eq("tenant_id", tid)
        .eq("sku", body.sku)
        .maybe_single()
        .execute().data
    )
    product_id = product["product_id"] if product else None

    return_id = str(uuid.uuid4())
    row = {
        "return_id": return_id, "tenant_id": tid,
        "product_id": product_id, "sku": body.sku,
        "product_name": body.product_name, "quantity": body.quantity,
        "return_type": body.return_type, "reason": body.reason,
        "order_id": body.order_id, "customer_name": body.customer_name,
        "notes": body.notes, "status": "pending",
    }
    result = supabase.table("returns").insert(row).execute()
    return result.data[0]


@router.patch("/{return_id}")
async def update_return(return_id: str, body: ReturnStatusUpdate, tenant: dict = Depends(get_current_tenant)):
    tid = tenant["tenant_id"]

    # Get the return record
    ret = (
        supabase.table("returns")
        .select("*")
        .eq("tenant_id", tid)
        .eq("return_id", return_id)
        .maybe_single()
        .execute().data
    )
    if not ret:
        raise HTTPException(status_code=404, detail="Return not found")

    update_data: dict = {"status": body.status}
    if body.notes:
        update_data["notes"] = body.notes
    if body.status == "processed":
        update_data["processed_at"] = datetime.now(timezone.utc).isoformat()

        # Auto-adjust stock for returns (increase stock back)
        if ret.get("product_id") and ret["return_type"] == "return":
            product = (
                supabase.table("products")
                .select("stock,sku")
                .eq("product_id", ret["product_id"])
                .maybe_single()
                .execute().data
            )
            if product:
                before = product.get("stock") or 0
                after = before + ret["quantity"]
                supabase.table("products").update({"stock": after}).eq("product_id", ret["product_id"]).execute()
                supabase.table("stock_history").insert({
                    "tenant_id": tid, "product_id": ret["product_id"], "sku": ret["sku"],
                    "change_type": "return", "quantity_change": ret["quantity"],
                    "quantity_before": before, "quantity_after": after,
                    "reference_id": return_id,
                    "note": f"Return processed: {ret.get('reason', '')}",
                }).execute()

    result = supabase.table("returns").update(update_data).eq("return_id", return_id).execute()
    return result.data[0]


@router.delete("/{return_id}", status_code=204)
async def delete_return(return_id: str, tenant: dict = Depends(get_current_tenant)):
    supabase.table("returns").delete().eq("tenant_id", tenant["tenant_id"]).eq("return_id", return_id).execute()
    return None
