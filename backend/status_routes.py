from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Literal

from auth import get_current_user, require_admin

router = APIRouter(tags=["Incident Status"])

AllowedStatus = Literal[
    "analysing",
    "under_review",
    "verified",
    "assigned",
    "in_progress",
    "resolved",
    "rejected"
]


class StatusUpdate(BaseModel):
    status: AllowedStatus
    notes: str | None = Field(default=None, max_length=1000)


def get_supabase():
    # Import only when an endpoint is called.
    # This avoids a circular import during application startup.
    from main import supabase

    if supabase is None:
        raise HTTPException(
            status_code=503,
            detail="Database connection unavailable"
        )

    return supabase


@router.patch("/reports/{report_id}/status")
def update_report_status(
    report_id: str,
    payload: StatusUpdate,
    current_user: dict = Depends(require_admin)
):
    db = get_supabase()

    try:
        result = db.rpc(
            "update_report_status",
            {
                "p_report_id": report_id,
                "p_new_status": payload.status,
                "p_notes": payload.notes
            }
        ).execute()

        return {
            "status": "success",
            "message": "Incident status updated successfully",
            "data": result.data
        }

    except Exception as exc:
        error_message = str(exc)

        if "Report not found" in error_message:
            raise HTTPException(status_code=404, detail="Report not found")

        if "Invalid status transition" in error_message:
            raise HTTPException(status_code=400, detail=error_message)

        if "already has this status" in error_message:
            raise HTTPException(
                status_code=409,
                detail="Incident already has this status"
            )

        raise HTTPException(
            status_code=500,
            detail="Unable to update incident status"
        )


@router.get("/reports/{report_id}/history")
def get_report_status_history(
    report_id: str,
    current_user: dict = Depends(get_current_user)
):
    db = get_supabase()

    try:
        report = (
            db.table("reports")
            .select("id, reporter_id")
            .eq("id", report_id)
            .maybe_single()
            .execute()
        )

        if not report.data:
            raise HTTPException(status_code=404, detail="Report not found")

        # Citizens can view only their own report history.
        if (
            current_user["role"] != "admin"
            and report.data.get("reporter_id") != current_user["id"]
        ):
            raise HTTPException(status_code=404, detail="Report not found")

        history = (
            db.table("status_history")
            .select("*")
            .eq("report_id", report_id)
            .order("created_at", desc=False)
            .execute()
        )

        return {
            "status": "success",
            "report_id": report_id,
            "count": len(history.data or []),
            "history": history.data or []
        }

    except HTTPException:
        raise

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Unable to retrieve status history"
        )