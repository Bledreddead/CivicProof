
import os

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Depends
from supabase import create_client, Client

from auth import get_current_user

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

BUCKET_NAME = "civic-evidence"
SIGNED_URL_EXPIRY_SECONDS = 900

router = APIRouter(tags=["Evidence"])

supabase: Client | None = None

if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def extract_signed_url(response) -> str | None:
    if isinstance(response, dict):
        data = response.get("data", response)
    else:
        data = getattr(response, "data", response)

    if isinstance(data, dict):
        signed_url = (
            data.get("signedURL")
            or data.get("signedUrl")
            or data.get("signed_url")
        )
    else:
        signed_url = None

    if not signed_url:
        return None

    signed_url = str(signed_url)

    if signed_url.startswith(("http://", "https://")):
        return signed_url

    base_url = SUPABASE_URL.rstrip("/")

    if signed_url.startswith("/storage/v1/"):
        return base_url + signed_url

    if not signed_url.startswith("/"):
        signed_url = "/" + signed_url

    return base_url + "/storage/v1" + signed_url


@router.get("/reports/{report_id}/evidence")
def get_report_evidence(
    report_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Return evidence metadata and temporary signed URLs.
    Citizens can access only their own reports.
    """

    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase credentials are not configured."
        )

    try:
        report_result = (
            supabase.table("reports")
            .select("id, reporter_id")
            .eq("id", report_id)
            .limit(1)
            .execute()
        )

        if not report_result.data:
            raise HTTPException(
                status_code=404,
                detail="Report not found."
            )

        report = report_result.data[0]

        if (
            current_user["role"] != "admin"
            and report.get("reporter_id") != current_user["id"]
        ):
            raise HTTPException(
                status_code=404,
                detail="Report not found."
            )

        evidence_result = (
            supabase.table("evidence")
            .select(
                "id,report_id,file_path,file_type,description,uploaded_at"
            )
            .eq("report_id", report_id)
            .order("uploaded_at", desc=True)
            .execute()
        )

        evidence_records = evidence_result.data or []
        evidence_with_urls = []

        for record in evidence_records:
            file_path = record.get("file_path")
            signed_url = None
            url_error = None

            if file_path:
                try:
                    response = (
                        supabase.storage
                        .from_(BUCKET_NAME)
                        .create_signed_url(
                            file_path,
                            SIGNED_URL_EXPIRY_SECONDS
                        )
                    )

                    signed_url = extract_signed_url(response)

                    if not signed_url:
                        url_error = (
                            "Storage did not return a signed URL."
                        )

                except Exception as error:
                    print(
                        "Signed URL generation failed for evidence "
                        f"{record.get('id')}: {error}"
                    )
                    url_error = (
                        "Could not generate a temporary evidence URL."
                    )
            else:
                url_error = "Evidence file path is unavailable."

            evidence_with_urls.append({
                "id": record.get("id"),
                "report_id": record.get("report_id"),
                "file_type": record.get("file_type"),
                "description": record.get("description"),
                "uploaded_at": record.get("uploaded_at"),
                "signed_url": signed_url,
                "url_expires_in_seconds": (
                    SIGNED_URL_EXPIRY_SECONDS if signed_url else None
                ),
                "url_error": url_error
            })

        return {
            "status": "success",
            "report_id": report_id,
            "evidence_count": len(evidence_with_urls),
            "signed_url_expiry_seconds": SIGNED_URL_EXPIRY_SECONDS,
            "evidence": evidence_with_urls
        }

    except HTTPException:
        raise

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Evidence retrieval failed."
        )
