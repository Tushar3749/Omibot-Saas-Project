"""
OmniBot SaaS — Discount Categories Router
Used to tag campaigns and specific_category discount rules.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import DiscountCategoryCreate, DiscountCategoryUpdate

router = APIRouter()


@router.get("/")
async def list_categories(tenant: dict = Depends(get_current_tenant)):
    res = (supabase.table("discount_categories")
           .select("*")
           .eq("tenant_id", tenant["tenant_id"])
           .order("category_name")
           .execute())
    return res.data or []


@router.post("/", status_code=201)
async def create_category(body: DiscountCategoryCreate, tenant: dict = Depends(get_current_tenant)):
    res = (supabase.table("discount_categories")
           .insert({
               "tenant_id":     tenant["tenant_id"],
               "category_name": body.category_name,
               "description":   body.description,
               "is_active":     body.is_active,
           })
           .execute())
    if not res.data:
        raise HTTPException(500, "Failed to create category")
    return res.data[0]


@router.patch("/{category_id}")
async def update_category(
    category_id: str,
    body: DiscountCategoryUpdate,
    tenant: dict = Depends(get_current_tenant),
):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    res = (supabase.table("discount_categories")
           .update(updates)
           .eq("category_id", category_id)
           .eq("tenant_id", tenant["tenant_id"])
           .execute())
    if not res.data:
        raise HTTPException(404, "Category not found")
    return res.data[0]


@router.delete("/{category_id}", status_code=204)
async def delete_category(category_id: str, tenant: dict = Depends(get_current_tenant)):
    (supabase.table("discount_categories")
     .delete()
     .eq("category_id", category_id)
     .eq("tenant_id", tenant["tenant_id"])
     .execute())
    return None
