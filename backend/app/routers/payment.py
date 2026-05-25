"""
OmniBot SaaS — Payment Router (SSLCommerz)
POST /api/payment/initiate  — Start a payment session
GET  /api/payment/success   — SSLCommerz success callback
GET  /api/payment/fail      — SSLCommerz fail callback
POST /api/payment/ipn       — Instant Payment Notification
GET  /api/payment/plans     — List available plans
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Request, Form
from fastapi.responses import RedirectResponse
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import PaymentInitRequest
from app.services.payment_service import PaymentService, PLANS

logger = logging.getLogger(__name__)
router  = APIRouter()
payment = PaymentService()


@router.get("/plans")
async def list_plans():
    return [
        {
            "id":       plan_id,
            "name":     info["name"],
            "amount":   info["amount"],
            "currency": "BDT",
            "duration": "30 days",
        }
        for plan_id, info in PLANS.items()
    ]


@router.post("/initiate")
async def initiate_payment(
    body: PaymentInitRequest,
    tenant: dict = Depends(get_current_tenant),
):
    result = payment.initiate_payment(
        tenant_id=tenant["tenant_id"],
        plan=body.plan,
        customer_name=body.customer_name,
        customer_email=tenant["email"],
        customer_phone=body.customer_phone,
        customer_address=body.customer_address or "Bangladesh",
    )
    if result["status"] != "success":
        raise HTTPException(status_code=400, detail=result.get("message", "Payment initiation failed"))
    return result


@router.get("/success")
async def payment_success(
    tran_id:    str = None,
    val_id:     str = None,
    status:     str = None,
    value_a:    str = None,   # tenant_id
    value_b:    str = None,   # plan
):
    """Redirect callback after successful payment."""
    if status == "VALID" and val_id and value_a and value_b:
        validated = payment.validate_payment(val_id)
        if validated.get("status") == "VALID":
            payment.activate_subscription(value_a, value_b, tran_id)
            from app.config import settings
            return RedirectResponse(
                url=f"{settings.FRONTEND_URL}/dashboard/subscription?success=true"
            )
    from app.config import settings
    return RedirectResponse(
        url=f"{settings.FRONTEND_URL}/dashboard/subscription?error=validation_failed"
    )


@router.get("/fail")
@router.get("/cancel")
async def payment_fail():
    from app.config import settings
    return RedirectResponse(
        url=f"{settings.FRONTEND_URL}/dashboard/subscription?error=payment_failed"
    )


@router.post("/ipn")
async def payment_ipn(request: Request):
    """Instant Payment Notification from SSLCommerz."""
    form_data = await request.form()
    data      = dict(form_data)
    val_id    = data.get("val_id")
    status    = data.get("status")
    tenant_id = data.get("value_a")
    plan      = data.get("value_b")
    tran_id   = data.get("tran_id")

    if status == "VALID" and val_id and tenant_id and plan:
        validated = payment.validate_payment(val_id)
        if validated.get("status") == "VALID":
            payment.activate_subscription(tenant_id, plan, tran_id)
            logger.info(f"IPN: Subscription activated for {tenant_id}")

    return {"status": "received"}


@router.get("/history")
async def payment_history(tenant: dict = Depends(get_current_tenant)):
    result = (
        supabase.table("transactions")
        .select("*")
        .eq("tenant_id", tenant["tenant_id"])
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


@router.get("/ai-config")
async def get_ai_config(tenant: dict = Depends(get_current_tenant)):
    result = (
        supabase.table("ai_config")
        .select("*")
        .eq("tenant_id", tenant["tenant_id"])
        .maybe_single()
        .execute()
    )
    # maybe_single().execute() returns None when 0 rows found
    return result.data if result is not None else {}


@router.patch("/ai-config")
async def update_ai_config(
    body: dict,
    tenant: dict = Depends(get_current_tenant),
):
    allowed = {
        "bot_name", "system_prompt", "language", "allow_negotiation",
        "escalation_keywords", "forbidden_topics", "prompt_injection_guard",
        "max_discount_pct", "negotiation_style", "negotiation_phrases",
    }
    update_data = {k: v for k, v in body.items() if k in allowed}
    if not update_data:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    result = (
        supabase.table("ai_config")
        .update(update_data)
        .eq("tenant_id", tenant["tenant_id"])
        .execute()
    )
    return result.data[0] if result.data else {}
