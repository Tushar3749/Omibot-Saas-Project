"""
OmniBot SaaS — SSLCommerz Payment Service
Handles subscription payment initiation and validation for Bangladesh.
Supports bKash, Nagad, cards via SSLCommerz gateway.
"""
import logging
import uuid
import requests
from datetime import datetime, timedelta, timezone
from app.config import settings
from app.database import supabase

logger = logging.getLogger(__name__)

# ── Plan Definitions ──────────────────────────────────────────────────────────
PLANS = {
    "starter":    {"amount": 2999, "name": "Starter Plan",    "duration_days": 30},
    "pro":        {"amount": 5999, "name": "Pro Plan",         "duration_days": 30},
    "enterprise": {"amount": 9999, "name": "Enterprise Plan",  "duration_days": 30},
}


class PaymentService:

    def initiate_payment(
        self,
        tenant_id: str,
        plan: str,
        customer_name: str,
        customer_email: str,
        customer_phone: str,
        customer_address: str = "Bangladesh",
    ) -> dict:
        """
        Initiate an SSLCommerz payment session.
        Returns {"status": "success", "payment_url": "..."} or {"status": "error", ...}
        """
        plan_info = PLANS.get(plan)
        if not plan_info:
            return {"status": "error", "message": f"Invalid plan: {plan}"}

        tran_id = f"OMNIBOT-{tenant_id[:8].upper()}-{uuid.uuid4().hex[:8].upper()}"
        amount  = plan_info["amount"]

        payload = {
            "store_id":         settings.SSLCOMMERZ_STORE_ID,
            "store_passwd":     settings.SSLCOMMERZ_STORE_PASS,
            "total_amount":     amount,
            "currency":         "BDT",
            "tran_id":          tran_id,
            "success_url":      f"{settings.BACKEND_URL}/api/payment/success",
            "fail_url":         f"{settings.BACKEND_URL}/api/payment/fail",
            "cancel_url":       f"{settings.BACKEND_URL}/api/payment/cancel",
            "ipn_url":          f"{settings.BACKEND_URL}/api/payment/ipn",
            "product_name":     plan_info["name"],
            "product_category": "SaaS Subscription",
            "product_profile":  "general",
            "cus_name":         customer_name,
            "cus_email":        customer_email,
            "cus_phone":        customer_phone,
            "cus_add1":         customer_address,
            "cus_country":      "Bangladesh",
            "ship_name":        customer_name,
            "ship_add1":        customer_address,
            "ship_country":     "Bangladesh",
            "shipping_method":  "NO",
            "num_of_item":      1,
            "emi_option":       0,
            "value_a":          tenant_id,    # Carry tenant_id through payment
            "value_b":          plan,
        }

        api_url = f"{settings.sslcommerz_base_url}/gwprocess/v4/api.php"

        try:
            resp = requests.post(api_url, data=payload, timeout=30)
            resp.raise_for_status()
            data = resp.json()

            if data.get("status") == "SUCCESS":
                # Save pending transaction
                supabase.table("transactions").insert({
                    "transaction_id": str(uuid.uuid4()),
                    "tenant_id":      tenant_id,
                    "tran_id":        tran_id,
                    "plan":           plan,
                    "amount":         amount,
                    "status":         "pending",
                }).execute()

                return {
                    "status":      "success",
                    "payment_url": data["GatewayPageURL"],
                    "tran_id":     tran_id,
                }
            else:
                logger.error(f"SSLCommerz initiation failed: {data}")
                return {"status": "error", "message": data.get("failedreason", "Unknown error")}

        except Exception as e:
            logger.error(f"SSLCommerz request error: {e}")
            return {"status": "error", "message": str(e)}

    def validate_payment(self, val_id: str) -> dict:
        """Validate a completed payment with SSLCommerz IPN."""
        url = (
            f"{settings.sslcommerz_base_url}/validator/api/validationserverAPI.php"
            f"?val_id={val_id}&store_id={settings.SSLCOMMERZ_STORE_ID}"
            f"&store_passwd={settings.SSLCOMMERZ_STORE_PASS}&format=json"
        )
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error(f"SSLCommerz validation error: {e}")
            return {}

    def activate_subscription(self, tenant_id: str, plan: str, tran_id: str) -> None:
        """Set subscription plan and expiry after successful payment."""
        plan_info = PLANS.get(plan, PLANS["starter"])
        expires_at = datetime.now(timezone.utc) + timedelta(days=plan_info["duration_days"])

        supabase.table("tenants").update({
            "plan":            plan,
            "plan_expires_at": expires_at.isoformat(),
        }).eq("tenant_id", tenant_id).execute()

        # Mark transaction as completed
        supabase.table("transactions").update({
            "status": "completed",
        }).eq("tran_id", tran_id).execute()

        logger.info(f"Subscription activated: tenant={tenant_id} plan={plan} expires={expires_at}")
