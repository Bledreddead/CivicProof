
import os
from evidence_routes import router as evidence_router
from status_routes import router as status_router
from cluster_routes import router as cluster_router
import uuid
import json
import time
import threading
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from datetime import datetime, timezone

from google import genai
from google.genai import types
from embedding_service import generate_report_embedding
from fastapi import UploadFile, File, Form
from ai_service import analyze_civic_image
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends
from auth import get_current_user, require_admin
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import create_client, Client


load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

supabase: Client | None = None

if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


app = FastAPI(
    title="CivicProof API",
    description="Evidence-to-Action Intelligence Platform",
    version="1.0.0"
)

# Allow local development and the deployed Vercel frontend.
allowed_origins = ["http://localhost:3000"]

frontend_origin = os.getenv("FRONTEND_URL", "").strip().rstrip("/")

if frontend_origin and frontend_origin not in allowed_origins:
    allowed_origins.append(frontend_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(evidence_router)
app.include_router(status_router)
app.include_router(cluster_router)


# ============================================================
# REVERSE GEOCODING - OPENSTREETMAP NOMINATIM
# ============================================================

GEOCODING_USER_AGENT = (
    "CivicProof/1.0 "
    "(civic infrastructure reporting application)"
)

_geocode_cache: dict[tuple[float, float], str | None] = {}
_geocode_lock = threading.Lock()
_last_geocode_request = 0.0


def format_geocoded_address(data: dict) -> str | None:
    """
    Convert a Nominatim response into a concise readable address.
    """

    address = data.get("address", {})

    components = []

    # Street-level information
    street = (
        address.get("road")
        or address.get("pedestrian")
        or address.get("residential")
    )

    if street:
        components.append(street)

    # Neighbourhood / locality
    locality = (
        address.get("neighbourhood")
        or address.get("suburb")
        or address.get("quarter")
        or address.get("hamlet")
    )

    if locality:
        components.append(locality)

    # City / town / village
    settlement = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("municipality")
    )

    if settlement:
        components.append(settlement)

    # District
    district = (
        address.get("state_district")
        or address.get("county")
    )

    if district:
        components.append(district)

    if address.get("state"):
        components.append(address["state"])

    if address.get("postcode"):
        components.append(address["postcode"])

    if address.get("country"):
        components.append(address["country"])

    # Remove duplicate components.
    unique_components = []
    seen = set()

    for component in components:
        normalized = str(component).strip()

        if not normalized:
            continue

        key = normalized.casefold()

        if key not in seen:
            unique_components.append(normalized)
            seen.add(key)

    if unique_components:
        return ", ".join(unique_components)[:300]

    # Fallback to Nominatim's display name.
    display_name = data.get("display_name")

    if display_name:
        return str(display_name)[:300]

    return None


def reverse_geocode(latitude: float, longitude: float) -> str | None:
    """
    Convert GPS coordinates into a human-readable address.

    Uses OpenStreetMap Nominatim.
    Applies an in-memory cache and a one-request-per-second
    throttle for this backend process.

    Geocoding failures return None and never prevent report creation.
    """

    global _last_geocode_request

    # Five decimal places are sufficient for caching nearby lookups.
    cache_key = (
        round(float(latitude), 5),
        round(float(longitude), 5)
    )

    with _geocode_lock:

        if cache_key in _geocode_cache:
            return _geocode_cache[cache_key]

        # Respect the public Nominatim request rate.
        elapsed = time.monotonic() - _last_geocode_request
        wait_time = max(0.0, 1.0 - elapsed)

        if wait_time > 0:
            time.sleep(wait_time)

        params = urlencode({
            "format": "jsonv2",
            "lat": latitude,
            "lon": longitude,
            "zoom": 18,
            "addressdetails": 1
        })

        url = (
            "https://nominatim.openstreetmap.org/reverse?"
            + params
        )

        request = Request(
            url,
            headers={
                "User-Agent": GEOCODING_USER_AGENT,
                "Accept-Language": "en"
            }
        )

        try:
            _last_geocode_request = time.monotonic()

            with urlopen(request, timeout=5) as response:
                response_data = json.loads(
                    response.read().decode("utf-8")
                )

            formatted_address = format_geocoded_address(
                response_data
            )

            _geocode_cache[cache_key] = formatted_address

            return formatted_address

        except Exception as error:
            print(f"Reverse geocoding unavailable: {error}")

            # Cache failure briefly in this process to avoid
            # repeatedly hitting the service for the same coordinates.
            _geocode_cache[cache_key] = None

            return None


class ReportCreate(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10)
    category: str = "other"
    location_text: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


@app.get("/")
def root():
    return {
        "message": "CivicProof API is running",
        "status": "operational"
    }


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.get("/supabase-check")
def supabase_check(
    current_user: dict = Depends(require_admin)
):
    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase credentials are not configured."
        )

    try:
        supabase.table("reports").select("id").limit(1).execute()

        return {
            "status": "connected",
            "database": "Supabase PostgreSQL",
            "message": "Successfully queried the reports table."
        }

    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))


# ============================================================
# REPORT CREATION AND LOCATION INTELLIGENCE
# ============================================================

@app.post("/reports")
def create_report(
    report: ReportCreate,
    current_user: dict = Depends(get_current_user)
):

    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase credentials are not configured."
        )

    if (report.latitude is None) != (report.longitude is None):
        raise HTTPException(
            status_code=400,
            detail="Both latitude and longitude must be provided together."
        )

    try:
        report_data = report.model_dump()
        # Ownership comes from the verified login, never from browser input.
        report_data["reporter_id"] = current_user["id"]

        # Preserve manually entered location descriptions.
        manual_location = (
            report_data.get("location_text") or ""
        ).strip()

        if manual_location:
            report_data["location_text"] = manual_location

        # If no manual location was supplied, try reverse geocoding.
        elif (
            report.latitude is not None
            and report.longitude is not None
        ):
            resolved_address = reverse_geocode(
                report.latitude,
                report.longitude
            )

            if resolved_address:
                report_data["location_text"] = resolved_address

        # If geocoding fails, the report is still saved.
        result = (
            supabase.table("reports")
            .insert(report_data)
            .execute()
        )

        if not result.data:
            raise HTTPException(
                status_code=500,
                detail="Report could not be saved."
            )

        saved_report = result.data[0]

        return {
            "status": "success",
            "message": "Report successfully submitted.",
            "report": saved_report,
            "location_intelligence": {
                "location_text": saved_report.get("location_text"),
                "coordinates_available": (
                    saved_report.get("latitude") is not None
                ),
                "address_available": bool(
                    saved_report.get("location_text")
                )
            }
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


@app.post("/reports/{report_id}/geocode")
def geocode_existing_report(report_id: str,
    current_user: dict = Depends(require_admin)
):

    """
    Reverse-geocode an existing report that has GPS coordinates
    but no manually supplied location description.
    """

    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase credentials are not configured."
        )

    try:
        result = (
            supabase.table("reports")
            .select("id, latitude, longitude, location_text")
            .eq("id", report_id)
            .limit(1)
            .execute()
        )

        if not result.data:
            raise HTTPException(
                status_code=404,
                detail="Report not found."
            )

        report = result.data[0]

        # Never overwrite an existing manual or previously resolved address.
        if report.get("location_text"):
            return {
                "status": "already_available",
                "report_id": report_id,
                "location_text": report["location_text"],
                "message": "Existing location description preserved."
            }

        latitude = report.get("latitude")
        longitude = report.get("longitude")

        if latitude is None or longitude is None:
            raise HTTPException(
                status_code=409,
                detail="This report does not have GPS coordinates."
            )

        address = reverse_geocode(
            latitude,
            longitude
        )

        if not address:
            return {
                "status": "unavailable",
                "report_id": report_id,
                "message": (
                    "Address could not be resolved. "
                    "The original GPS coordinates remain available."
                )
            }

        update_result = (
            supabase.table("reports")
            .update({
                "location_text": address
            })
            .eq("id", report_id)
            .execute()
        )

        if not update_result.data:
            raise HTTPException(
                status_code=500,
                detail="Address was found but could not be saved."
            )

        return {
            "status": "success",
            "report_id": report_id,
            "location_text": address,
            "message": "Location successfully resolved and saved.",
            "geocoding_provider": "OpenStreetMap Nominatim"
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Location resolution failed: {str(error)}"
        )


# ============================================================
# NEARBY REPORTS
# ============================================================

@app.get("/reports/{report_id}/nearby")
def get_nearby_reports(
    report_id: str,
    radius_meters: int = 250
,
    current_user: dict = Depends(require_admin)
):

    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase credentials are not configured."
        )

    if radius_meters < 1 or radius_meters > 5000:
        raise HTTPException(
            status_code=400,
            detail="Radius must be between 1 and 5000 metres."
        )

    try:
        result = supabase.rpc(
            "find_nearby_reports",
            {
                "p_report_id": report_id,
                "p_radius_meters": radius_meters
            }
        ).execute()

        return {
            "status": "success",
            "report_id": report_id,
            "search_radius_meters": radius_meters,
            "nearby_count": len(result.data),
            "nearby_reports": result.data
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Nearby report search failed: {str(error)}"
        )


# ============================================================
# IMAGE ANALYSIS AND EVIDENCE UPLOAD
# ============================================================

@app.post("/analyse-image")
async def analyse_image(
    report_id: str = Form(...),
    image: UploadFile = File(...),
    description: str = Form(...)
,
    current_user: dict = Depends(require_admin)
):

    allowed_types = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ]

    if image.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="Only JPEG, PNG and WEBP images are supported."
        )

    image_bytes = await image.read()

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="Uploaded image is empty."
        )

    if len(image_bytes) > 8 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="Image must be smaller than 8 MB."
        )

    extensions = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp"
    }

    file_path = (
        f"{report_id}/{uuid.uuid4()}.{extensions[image.content_type]}"
    )

    # Upload photograph to private Supabase Storage.
    try:
        supabase.storage.from_("civic-evidence").upload(
            path=file_path,
            file=image_bytes,
            file_options={
                "content-type": image.content_type
            }
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Evidence upload failed: {str(error)}"
        )

    # Save evidence metadata.
    try:
        evidence_result = supabase.table("evidence").insert({
            "report_id": report_id,
            "file_path": file_path,
            "file_type": image.content_type,
            "description": description
        }).execute()

        evidence_record = (
            evidence_result.data[0]
            if evidence_result.data else None
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=(
                "Image uploaded, but evidence metadata saving failed: "
                f"{str(error)}"
            )
        )

    # Analyse photograph using Gemini.
    try:
        analysis = analyze_civic_image(
            image_bytes=image_bytes,
            mime_type=image.content_type,
            description=description
        )

    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=(
                "Evidence successfully stored, but AI analysis failed: "
                f"{str(error)}"
            )
        )

    # Save AI analysis.
    try:
        result = supabase.table("ai_analyses").insert({
            "report_id": report_id,
            "model_name": "gemini-3.5-flash-lite",
            "category": analysis["category"],
            "asset_type": analysis["asset_type"],
            "severity": analysis["severity"],
            "observations": analysis["observations"],
            "risks": analysis["potential_risks"],
            "missing_information": analysis["missing_information"],
            "confidence": analysis["confidence"],
            "requires_human_review": analysis["requires_human_review"],
            "raw_analysis": analysis
        }).execute()

        saved_record = result.data[0] if result.data else None

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=(
                "Evidence stored and AI analysis completed, "
                f"but analysis saving failed: {str(error)}"
            )
        )

    return {
        "status": "success",
        "message": "Evidence uploaded and image analysed successfully.",
        "report_id": report_id,
        "evidence_record": evidence_record,
        "analysis_record": saved_record,
        "analysis": analysis
    }
@app.post("/reports/{report_id}/evidence")
async def upload_report_evidence(
    report_id: str,
    image: UploadFile = File(...),
    description: str = Form(""),
    current_user: dict = Depends(get_current_user)
):
    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase credentials are not configured."
        )

    # Verify report ownership before accepting evidence.
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

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not verify the report."
        )

    if (
        current_user["role"] != "admin"
        and report.get("reporter_id") != current_user["id"]
    ):
        raise HTTPException(
            status_code=403,
            detail="You can only upload evidence to your own reports."
        )

    allowed_types = ["image/jpeg", "image/png", "image/webp"]

    if image.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="Only JPEG, PNG and WEBP images are supported."
        )

    image_bytes = await image.read()

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="Uploaded image is empty."
        )

    if len(image_bytes) > 8 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="Image must be smaller than 8 MB."
        )

    extensions = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp"
    }

    file_path = (
        f"{current_user['id']}/{report_id}/"
        f"{uuid.uuid4()}.{extensions[image.content_type]}"
    )

    # Store the photograph privately.
    try:
        supabase.storage.from_("civic-evidence").upload(
            path=file_path,
            file=image_bytes,
            file_options={"content-type": image.content_type}
        )
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Evidence upload failed: {str(error)}"
        )

    # Save evidence metadata.
    try:
        evidence_result = (
            supabase.table("evidence")
            .insert({
                "report_id": report_id,
                "file_path": file_path,
                "file_type": image.content_type,
                "description": description
            })
            .execute()
        )

        evidence_record = (
            evidence_result.data[0]
            if evidence_result.data else None
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=(
                "Image uploaded, but evidence metadata could not be saved: "
                f"{str(error)}"
            )
        )

    # Automatically analyse the citizen's uploaded photograph.
    try:
        analysis = analyze_civic_image(
            image_bytes=image_bytes,
            mime_type=image.content_type,
            description=description
        )
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=(
                "Evidence was saved, but AI analysis failed: "
                f"{str(error)}"
            )
        )

    # Save the AI result using the existing database structure.
    try:
        analysis_result = (
            supabase.table("ai_analyses")
            .insert({
                "report_id": report_id,
                "model_name": os.getenv(
                    "GEMINI_MODEL", "gemini-3.5-flash-lite"
                ),
                "category": analysis["category"],
                "asset_type": analysis["asset_type"],
                "severity": analysis["severity"],
                "observations": analysis["observations"],
                "risks": analysis["potential_risks"],
                "missing_information": analysis["missing_information"],
                "confidence": analysis["confidence"],
                "requires_human_review": analysis["requires_human_review"],
                "raw_analysis": analysis
            })
            .execute()
        )

        analysis_record = (
            analysis_result.data[0]
            if analysis_result.data else None
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=(
                "Evidence was saved and AI analysis completed, "
                f"but saving the analysis failed: {str(error)}"
            )
        )

    return {
        "status": "success",
        "message": "Evidence uploaded and AI analysis completed.",
        "report_id": report_id,
        "evidence_record": evidence_record,
        "analysis_record": analysis_record,
        "analysis": analysis
    }


# ============================================================
# SEMANTIC EMBEDDINGS
# ============================================================

@app.post("/reports/{report_id}/embed")
def embed_report(report_id: str,
    current_user: dict = Depends(require_admin)
):

    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase credentials are not configured."
        )

    try:
        report_result = (
            supabase.table("reports")
            .select("id, title, description, category")
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

        searchable_text = (
            f"Category: {report['category']}\n"
            f"Title: {report['title']}\n"
            f"Description: {report['description']}"
        )

        embedding = generate_report_embedding(searchable_text)

        vector_string = "[" + ",".join(
            str(value) for value in embedding
        ) + "]"

        saved = (
            supabase.table("report_embeddings")
            .upsert({
                "report_id": report_id,
                "embedding": vector_string,
                "model_name": "gemini-embedding-001"
            })
            .execute()
        )

        return {
            "status": "success",
            "report_id": report_id,
            "model": "gemini-embedding-001",
            "dimensions": len(embedding),
            "message": "Report embedding generated and saved.",
            "saved": bool(saved.data)
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Embedding generation failed: {str(error)}"
        )


# ============================================================
# SEMANTIC SIMILARITY
# ============================================================

@app.get("/reports/{report_id}/similar")
def get_similar_reports(
    report_id: str,
    radius_meters: int = 250,
    similarity_threshold: float = 0.75
,
    current_user: dict = Depends(require_admin)
):

    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase credentials are not configured."
        )

    if radius_meters < 1 or radius_meters > 5000:
        raise HTTPException(
            status_code=400,
            detail="Radius must be between 1 and 5000 metres."
        )

    if similarity_threshold < 0 or similarity_threshold > 1:
        raise HTTPException(
            status_code=400,
            detail="Similarity threshold must be between 0 and 1."
        )

    try:
        result = supabase.rpc(
            "find_similar_reports",
            {
                "p_report_id": report_id,
                "p_radius_meters": radius_meters,
                "p_similarity_threshold": similarity_threshold
            }
        ).execute()

        return {
            "status": "success",
            "report_id": report_id,
            "search_radius_meters": radius_meters,
            "similarity_threshold": similarity_threshold,
            "similar_count": len(result.data),
            "similar_reports": result.data
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Semantic search failed: {str(error)}"
        )


# ============================================================
# DUPLICATE INTELLIGENCE
# ============================================================

@app.get("/reports/{report_id}/duplicates")
def detect_duplicate_candidates(
    report_id: str,
    radius_meters: int = 250,
    similarity_threshold: float = 0.75
,
    current_user: dict = Depends(require_admin)
):

    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase credentials are not configured."
        )

    if radius_meters < 1 or radius_meters > 5000:
        raise HTTPException(
            status_code=400,
            detail="Radius must be between 1 and 5000 metres."
        )

    if not 0 <= similarity_threshold <= 1:
        raise HTTPException(
            status_code=400,
            detail="Similarity threshold must be between 0 and 1."
        )

    try:
        embedding_check = (
            supabase.table("report_embeddings")
            .select("report_id")
            .eq("report_id", report_id)
            .limit(1)
            .execute()
        )

        if not embedding_check.data:
            raise HTTPException(
                status_code=409,
                detail="Generate an embedding for this report first."
            )

        nearby_result = supabase.rpc(
            "find_nearby_reports",
            {
                "p_report_id": report_id,
                "p_radius_meters": radius_meters
            }
        ).execute()

        nearby_reports = nearby_result.data or []

        similar_result = supabase.rpc(
            "find_similar_reports",
            {
                "p_report_id": report_id,
                "p_radius_meters": radius_meters,
                "p_similarity_threshold": similarity_threshold
            }
        ).execute()

        similar_reports = similar_result.data or []

        similar_by_id = {
            report["id"]: report
            for report in similar_reports
        }

        candidates = []

        for nearby in nearby_reports:
            report_id_found = nearby["id"]
            semantic_match = similar_by_id.get(report_id_found)

            if semantic_match:
                candidates.append({
                    **nearby,
                    "match_type": "potential_duplicate",
                    "similarity_score": semantic_match[
                        "similarity_score"
                    ],
                    "explanation": (
                        "Geographically close and semantically similar. "
                        "Requires human verification."
                    )
                })
            else:
                candidates.append({
                    **nearby,
                    "match_type": "nearby_only",
                    "similarity_score": None,
                    "explanation": (
                        "Geographically close, but did not pass "
                        "the semantic duplicate filters."
                    )
                })

        return {
            "status": "success",
            "source_report_id": report_id,
            "search_radius_meters": radius_meters,
            "similarity_threshold": similarity_threshold,
            "nearby_count": len(nearby_reports),
            "potential_duplicate_count": len(similar_reports),
            "candidates": candidates
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Duplicate detection failed: {str(error)}"
        )


# ============================================================
# EXPLAINABLE PRIORITY / TRIAGE
# ============================================================

@app.post("/reports/{report_id}/triage")
def calculate_report_priority(report_id: str,
    current_user: dict = Depends(require_admin)
):

    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase credentials are not configured."
        )

    try:
        report_result = (
            supabase.table("reports")
            .select("id, title, category, status")
            .eq("id", report_id)
            .limit(1)
            .execute()
        )

        if not report_result.data:
            raise HTTPException(
                status_code=404,
                detail="Report not found."
            )

        analysis_result = (
            supabase.table("ai_analyses")
            .select("*")
            .eq("report_id", report_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

        if not analysis_result.data:
            raise HTTPException(
                status_code=409,
                detail="Analyse this report before calculating priority."
            )

        analysis = analysis_result.data[0]

        evidence_result = (
            supabase.table("evidence")
            .select("id")
            .eq("report_id", report_id)
            .execute()
        )

        evidence_count = len(evidence_result.data or [])

        embedding_result = (
            supabase.table("report_embeddings")
            .select("report_id")
            .eq("report_id", report_id)
            .limit(1)
            .execute()
        )

        if embedding_result.data:
            similar_result = supabase.rpc(
                "find_similar_reports",
                {
                    "p_report_id": report_id,
                    "p_radius_meters": 250,
                    "p_similarity_threshold": 0.75
                }
            ).execute()

            corroborating_count = len(similar_result.data or [])
        else:
            corroborating_count = 0

        severity = analysis["severity"]

        severity_score = (severity / 5) * 100

        corroboration_score = (
            min(corroborating_count, 5) / 5
        ) * 100

        evidence_score = (
            min(evidence_count, 3) / 3
        ) * 100

        priority_score = round(
            (severity_score * 0.50)
            + (corroboration_score * 0.30)
            + (evidence_score * 0.20),
            2
        )

        confidence = float(analysis["confidence"])

        requires_review = (
            analysis["requires_human_review"]
            or confidence < 0.65
        )

        update_result = (
            supabase.table("reports")
            .update({
                "severity": severity,
                "priority_score": priority_score,
                "requires_human_review": requires_review
            })
            .eq("id", report_id)
            .execute()
        )

        return {
            "status": "success",
            "report_id": report_id,
            "priority_score": priority_score,
            "severity": severity,
            "corroborating_reports": corroborating_count,
            "evidence_count": evidence_count,
            "component_scores": {
                "severity": round(severity_score, 2),
                "corroboration": round(corroboration_score, 2),
                "evidence_completeness": round(evidence_score, 2)
            },
            "weights": {
                "severity": 0.50,
                "corroboration": 0.30,
                "evidence": 0.20
            },
            "ai_confidence": confidence,
            "requires_human_review": requires_review,
            "database_updated": bool(update_result.data)
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Priority calculation failed: {str(error)}"
        )


# ============================================================
# DEPARTMENT ROUTING
# ============================================================

@app.get("/reports/{report_id}/route")
def route_report(report_id: str,
    current_user: dict = Depends(require_admin)
):

    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase credentials are not configured."
        )

    jurisdiction = "Pune Municipal Corporation (PMC)"

    try:
        report_result = (
            supabase.table("reports")
            .select("id, title, category")
            .eq("id", report_id)
            .limit(1)
            .execute()
        )

        if not report_result.data:
            raise HTTPException(
                status_code=404,
                detail="Report not found."
            )

        analysis_result = (
            supabase.table("ai_analyses")
            .select("category, asset_type")
            .eq("report_id", report_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

        if not analysis_result.data:
            raise HTTPException(
                status_code=409,
                detail="AI analysis is required before department routing."
            )

        analysis = analysis_result.data[0]
        category = analysis["category"]
        asset_type = analysis["asset_type"]

        rule_result = (
            supabase.table("routing_rules")
            .select("*")
            .eq("category", category)
            .eq("jurisdiction", jurisdiction)
            .limit(1)
            .execute()
        )

        if not rule_result.data:
            return {
                "status": "no_matching_rule",
                "report_id": report_id,
                "category": category,
                "asset_type": asset_type,
                "jurisdiction": jurisdiction,
                "message": "No department mapping exists for this category."
            }

        rule = rule_result.data[0]

        department_result = (
            supabase.table("departments")
            .select("*")
            .eq("id", rule["department_id"])
            .limit(1)
            .execute()
        )

        if not department_result.data:
            raise HTTPException(
                status_code=404,
                detail="Mapped department could not be found."
            )

        department = department_result.data[0]

        return {
            "status": "success",
            "report_id": report_id,
            "routing": {
                "category": category,
                "detected_asset_type": asset_type,
                "recommended_asset_type": rule["asset_type"],
                "department": department["name"],
                "jurisdiction": jurisdiction,
                "rule_verified": rule["is_verified"],
                "verification_status": (
                    "verified" if rule["is_verified"]
                    else "unverified_candidate"
                ),
                "source_url": rule["source_url"]
            },
            "limitations": [
                "Department mapping has not been officially verified.",
                "PMC jurisdiction is configured as the pilot jurisdiction; "
                "the report coordinates have not been checked against "
                "an official PMC boundary."
            ]
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Department routing failed: {str(error)}"
        )


# ============================================================
# AI-GENERATED ACTION BRIEF
# ============================================================

@app.post("/reports/{report_id}/brief")
def generate_action_brief(report_id: str,
    current_user: dict = Depends(require_admin)
):

    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase credentials are not configured."
        )

    try:
        report_result = (
            supabase.table("reports")
            .select("*")
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

        analysis_result = (
            supabase.table("ai_analyses")
            .select("*")
            .eq("report_id", report_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

        if not analysis_result.data:
            raise HTTPException(
                status_code=409,
                detail="AI analysis is required before generating a brief."
            )

        analysis = analysis_result.data[0]

        evidence_result = (
            supabase.table("evidence")
            .select("id, file_type, description, uploaded_at")
            .eq("report_id", report_id)
            .execute()
        )

        evidence_records = evidence_result.data or []

        jurisdiction = "Pune Municipal Corporation (PMC)"

        routing_result = (
            supabase.table("routing_rules")
            .select("department_id, asset_type, is_verified, source_url")
            .eq("category", analysis["category"])
            .eq("jurisdiction", jurisdiction)
            .limit(1)
            .execute()
        )

        department = None
        department_id = None
        routing_verified = False
        routing_source = None

        if routing_result.data:
            rule = routing_result.data[0]
            department_id = rule["department_id"]
            routing_verified = rule["is_verified"]
            routing_source = rule["source_url"]

            department_result = (
                supabase.table("departments")
                .select("name")
                .eq("id", department_id)
                .limit(1)
                .execute()
            )

            if department_result.data:
                department = department_result.data[0]["name"]

        duplicate_result = supabase.rpc(
            "find_similar_reports",
            {
                "p_report_id": report_id,
                "p_radius_meters": 250,
                "p_similarity_threshold": 0.75
            }
        ).execute()

        similar_reports = duplicate_result.data or []

        nearby_result = supabase.rpc(
            "find_nearby_reports",
            {
                "p_report_id": report_id,
                "p_radius_meters": 250
            }
        ).execute()

        nearby_reports = nearby_result.data or []

        evidence_summary = {
            "category": analysis["category"],
            "asset_type": analysis["asset_type"],
            "observations": analysis["observations"],
            "potential_risks": analysis["risks"],
            "missing_information": analysis["missing_information"],
            "ai_confidence": analysis["confidence"],
            "requires_human_review": analysis["requires_human_review"],
            "limitations": analysis["raw_analysis"].get("limitations", []),
            "evidence_count": len(evidence_records),
            "latitude": report.get("latitude"),
            "longitude": report.get("longitude"),
            "location_text": report.get("location_text"),
            "nearby_report_count": len(nearby_reports),
            "potential_duplicate_count": len(similar_reports),
            "potential_duplicates": similar_reports
        }

        priority_explanation = {
            "priority_score": report.get("priority_score"),
            "severity": report.get("severity"),
            "scoring_method": {
                "severity_weight": 0.50,
                "corroboration_weight": 0.30,
                "evidence_completeness_weight": 0.20
            },
            "corroborating_reports": len(similar_reports),
            "evidence_count": len(evidence_records),
            "note": (
                "Priority score is generated by CivicProof's deterministic "
                "triage formula. It is not an official municipal priority."
            )
        }

        source_data = {
            "report_title": report["title"],
            "description": report["description"],
            "category": analysis["category"],
            "asset_type": analysis["asset_type"],
            "observations": analysis["observations"],
            "risks": analysis["risks"],
            "missing_information": analysis["missing_information"],
            "severity": analysis["severity"],
            "severity_reason": analysis["raw_analysis"].get("severity_reason"),
            "confidence": analysis["confidence"],
            "priority_score": report.get("priority_score"),
            "department": department,
            "routing_verified": routing_verified,
            "nearby_reports": len(nearby_reports),
            "potential_duplicates": len(similar_reports),
            "human_review_required": analysis["requires_human_review"]
        }

        api_key = os.getenv("GEMINI_API_KEY")

        if not api_key:
            raise HTTPException(
                status_code=500,
                detail="Gemini API key is not configured."
            )

        client = genai.Client(api_key=api_key)

        prompt = f"""
You are CivicProof's municipal infrastructure inspection assistant.

Generate a concise, professional inspection action brief using ONLY
the supplied source data.

STRICT RULES:
- Never invent facts, measurements, damage dimensions, or causes.
- Distinguish AI observations from verified facts.
- Do not claim that a department has accepted the incident.
- Do not claim that a complaint has been officially submitted.
- If department routing is unverified, explicitly say so.
- If information is missing, state that it needs field verification.
- Recommend practical inspection actions, not unsupported repairs.

SOURCE DATA:
{json.dumps(source_data, indent=2)}

Return ONLY valid JSON with these three string fields:
{{
  "title": "Short incident title",
  "executive_summary": "Professional incident summary",
  "recommended_action": "Practical inspection and follow-up recommendation"
}}
"""

        response = client.models.generate_content(
            model="gemini-3.5-flash-lite",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json"
            )
        )

        generated = json.loads(response.text)

        brief_data = {
            "report_id": report_id,
            "department_id": department_id,
            "title": generated["title"],
            "executive_summary": generated["executive_summary"],
            "recommended_action": generated["recommended_action"],
            "evidence_summary": evidence_summary,
            "priority_explanation": priority_explanation,
            "generated_at": datetime.now(timezone.utc).isoformat()
        }

        saved_result = (
            supabase.table("action_briefs")
            .insert(brief_data)
            .execute()
        )

        return {
            "status": "success",
            "message": "Action brief generated and saved.",
            "brief": saved_result.data[0],
            "department": department,
            "routing_verified": routing_verified
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Action brief generation failed: {str(error)}"
        )


# ============================================================
# REPORT REGISTRY
# ============================================================

@app.get("/reports")
def get_reports(
    current_user: dict = Depends(get_current_user)
):
    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase credentials are not configured."
        )

    try:
        query = (
            supabase.table("reports")
            .select("*")
        )

        if current_user["role"] != "admin":
            query = query.eq("reporter_id", current_user["id"])

        result = (
            query
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )

        return {
            "status": "success",
            "count": len(result.data or []),
            "reports": result.data or []
        }

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve reports."
        )

# ============================================================
# INCIDENT INVESTIGATION
# ============================================================

@app.get("/reports/{report_id}/investigation")
def get_investigation(
    report_id: str,
    current_user: dict = Depends(get_current_user)
):

    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase is not configured."
        )

    try:
        # Report
        report_result = (
            supabase.table("reports")
            .select("*")
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

        # Citizens can access only their own investigations.
        if (
            current_user["role"] != "admin"
            and report.get("reporter_id") != current_user["id"]
        ):
            raise HTTPException(
                status_code=404,
                detail="Report not found."
            )

        # Latest AI analysis
        analysis_result = (
            supabase.table("ai_analyses")
            .select("*")
            .eq("report_id", report_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

        analysis = (
            analysis_result.data[0]
            if analysis_result.data else None
        )

        # Evidence metadata
        evidence_result = (
            supabase.table("evidence")
            .select("id,file_type,description,uploaded_at")
            .eq("report_id", report_id)
            .execute()
        )

        evidence = evidence_result.data or []

        # Latest action brief
        brief_result = (
            supabase.table("action_briefs")
            .select("*")
            .eq("report_id", report_id)
            .order("generated_at", desc=True)
            .limit(1)
            .execute()
        )

        brief = (
            brief_result.data[0]
            if brief_result.data else None
        )

        # Department recommendation
        routing = None

        if analysis:
            rule_result = (
                supabase.table("routing_rules")
                .select("*")
                .eq("category", analysis["category"])
                .eq("jurisdiction", "Pune Municipal Corporation (PMC)")
                .limit(1)
                .execute()
            )

            if rule_result.data:
                rule = rule_result.data[0]

                department_result = (
                    supabase.table("departments")
                    .select("id,name,jurisdiction,source_url")
                    .eq("id", rule["department_id"])
                    .limit(1)
                    .execute()
                )

                if department_result.data:
                    routing = {
                        "department": department_result.data[0],
                        "rule_verified": rule["is_verified"],
                        "recommended_asset_type": rule["asset_type"],
                        "source_url": rule["source_url"]
                    }

        # Duplicate intelligence
        duplicate_data = {
            "nearby_count": 0,
            "potential_duplicate_count": 0,
            "candidates": [],
            "available": False
        }

        try:
            duplicate_result = supabase.rpc(
                "find_nearby_reports",
                {
                    "p_report_id": report_id,
                    "p_radius_meters": 250
                }
            ).execute()

            similar_result = supabase.rpc(
                "find_similar_reports",
                {
                    "p_report_id": report_id,
                    "p_radius_meters": 250,
                    "p_similarity_threshold": 0.75
                }
            ).execute()

            similar_ids = {
                item["id"] for item in (similar_result.data or [])
            }

            candidates = []

            for item in duplicate_result.data or []:
                candidates.append({
                    **item,
                    "match_type": (
                        "potential_duplicate"
                        if item["id"] in similar_ids
                        else "nearby_only"
                    )
                })

            duplicate_data = {
                "nearby_count": len(candidates),
                "potential_duplicate_count": len(similar_ids),
                "candidates": candidates,
                "available": True
            }

        except Exception as duplicate_error:
            duplicate_data["error"] = str(duplicate_error)

        return {
            "status": "success",
            "report": report,
            "analysis": analysis,
            "evidence": evidence,
            "routing": routing,
            "duplicates": duplicate_data,
            "action_brief": brief
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Investigation retrieval failed: {str(error)}"
        )



