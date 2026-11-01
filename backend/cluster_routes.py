from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Depends
from auth import require_admin


router = APIRouter(tags=["Incident Clustering"])


def get_supabase():
    # Lazy import avoids a circular import with main.py.
    from main import supabase

    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase credentials are not configured."
        )

    return supabase


def validate_uuid(value: str, field_name: str):
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {field_name}."
        )


def to_float(value):
    if value is None:
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


@router.post("/reports/{report_id}/cluster")
def build_report_cluster(
    report_id: str,
    radius_meters: int = 250,
    similarity_threshold: float = 0.75,
    current_user: dict = Depends(require_admin)
):
    """
    Create or update a candidate cluster using real geographic
    and semantic matches. A cluster is never automatically confirmed.
    """

    report_id = validate_uuid(report_id, "report ID")

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

    db = get_supabase()
    new_cluster_id = None

    try:
        # 1. Fetch the source report.
        source_result = (
            db.table("reports")
            .select("id,title,category,status,location_text")
            .eq("id", report_id)
            .limit(1)
            .execute()
        )

        if not source_result.data:
            raise HTTPException(
                status_code=404,
                detail="Source report not found."
            )

        source = source_result.data[0]

        # 2. Ensure the source report has a semantic embedding.
        embedding_result = (
            db.table("report_embeddings")
            .select("report_id")
            .eq("report_id", report_id)
            .limit(1)
            .execute()
        )

        if not embedding_result.data:
            raise HTTPException(
                status_code=409,
                detail="Generate an embedding for this report first."
            )

        # 3. Find geographically nearby reports.
        nearby_result = db.rpc(
            "find_nearby_reports",
            {
                "p_report_id": report_id,
                "p_radius_meters": radius_meters
            }
        ).execute()

        nearby_reports = nearby_result.data or []

        # 4. Find reports passing semantic and geographic filters.
        similar_result = db.rpc(
            "find_similar_reports",
            {
                "p_report_id": report_id,
                "p_radius_meters": radius_meters,
                "p_similarity_threshold": similarity_threshold
            }
        ).execute()

        similar_reports = similar_result.data or []

        similar_by_id = {
            str(item["id"]): item
            for item in similar_reports
        }

        # Only use reports returned by BOTH matching operations.
        matched_candidates = []

        for nearby in nearby_reports:
            candidate_id = str(nearby["id"])
            semantic_match = similar_by_id.get(candidate_id)

            if semantic_match and candidate_id != report_id:
                matched_candidates.append({
                    "id": candidate_id,
                    "similarity_score": to_float(
                        semantic_match.get("similarity_score")
                    ),
                    "distance_meters": to_float(
                        nearby.get("distance_meters")
                    )
                })

        # Avoid duplicate candidate IDs.
        unique_candidates = {
            item["id"]: item
            for item in matched_candidates
        }

        matched_candidates = list(unique_candidates.values())

        # 5. Do not create a cluster from a single report.
        if not matched_candidates:
            return {
                "status": "success",
                "result": "no_cluster_created",
                "message": (
                    "No other report passed both geographic and "
                    "semantic matching requirements."
                ),
                "source_report_id": report_id,
                "nearby_count": len(nearby_reports),
                "semantic_match_count": len(similar_reports),
                "cluster_created": False,
                "candidate_membership_count": 0
            }

        candidate_ids = [
            item["id"] for item in matched_candidates
        ]

        all_member_ids = list(dict.fromkeys(
            [report_id] + candidate_ids
        ))

        # 6. Fetch candidate report details.
        candidate_reports_result = (
            db.table("reports")
            .select("id,title,category,status,location_text")
            .in_("id", candidate_ids)
            .execute()
        )

        candidate_reports = {
            str(item["id"]): item
            for item in (candidate_reports_result.data or [])
        }

        # Only retain candidates that still exist.
        matched_candidates = [
            item for item in matched_candidates
            if item["id"] in candidate_reports
        ]

        candidate_ids = [
            item["id"] for item in matched_candidates
        ]

        if not candidate_ids:
            return {
                "status": "success",
                "result": "no_cluster_created",
                "message": "No eligible candidate reports remain.",
                "source_report_id": report_id,
                "cluster_created": False
            }

        all_member_ids = list(dict.fromkeys(
            [report_id] + candidate_ids
        ))

        # 7. Check whether these reports already belong to clusters.
        membership_result = (
            db.table("cluster_members")
            .select("cluster_id,report_id")
            .in_("report_id", all_member_ids)
            .execute()
        )

        existing_memberships = membership_result.data or []

        existing_cluster_ids = list(dict.fromkeys(
            str(item["cluster_id"])
            for item in existing_memberships
        ))

        cluster_id = None
        cluster_created = False

        if len(existing_cluster_ids) > 1:
            raise HTTPException(
                status_code=409,
                detail=(
                    "These reports already belong to multiple clusters. "
                    "Automatic merging is blocked; manual review is required."
                )
            )

        if existing_cluster_ids:
            cluster_id = existing_cluster_ids[0]

            existing_cluster_result = (
                db.table("incident_clusters")
                .select("id,status")
                .eq("id", cluster_id)
                .limit(1)
                .execute()
            )

            if not existing_cluster_result.data:
                raise HTTPException(
                    status_code=409,
                    detail="An existing cluster membership is inconsistent."
                )

            existing_cluster = existing_cluster_result.data[0]

            if existing_cluster["status"] != "candidate":
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "An involved report belongs to a non-candidate "
                        "cluster. Automatic modification is blocked."
                    )
                )

        else:
            # 8. Create a new candidate cluster.
            cluster_id = str(uuid4())

            source_title = source.get("title") or "Infrastructure incident"
            category = source.get("category")

            db.table("incident_clusters").insert({
                "id": cluster_id,
                "title": (
                    f"{source_title} — potential related reports"
                ),
                "category": category,
                "status": "candidate",
                "created_at": datetime.now(timezone.utc).isoformat()
            }).execute()

            new_cluster_id = cluster_id
            cluster_created = True

        # 9. Add only missing memberships.
        existing_member_ids = {
            str(item["report_id"])
            for item in existing_memberships
            if str(item["cluster_id"]) == cluster_id
        }

        memberships_to_insert = []
        now = datetime.now(timezone.utc).isoformat()

        # Source report: no artificial similarity score.
        if report_id not in existing_member_ids:
            memberships_to_insert.append({
                "cluster_id": cluster_id,
                "report_id": report_id,
                "similarity_score": None,
                "distance_meters": None,
                "added_at": now
            })

        for candidate in matched_candidates:
            candidate_id = candidate["id"]

            if candidate_id in existing_member_ids:
                continue

            memberships_to_insert.append({
                "cluster_id": cluster_id,
                "report_id": candidate_id,
                "similarity_score": candidate["similarity_score"],
                "distance_meters": candidate["distance_meters"],
                "added_at": now
            })

        if memberships_to_insert:
            db.table("cluster_members").insert(
                memberships_to_insert
            ).execute()

        # 10. Return the actual persisted cluster information.
        final_membership_result = (
            db.table("cluster_members")
            .select("report_id,similarity_score,distance_meters")
            .eq("cluster_id", cluster_id)
            .execute()
        )

        final_memberships = final_membership_result.data or []

        return {
            "status": "success",
            "result": (
                "cluster_created"
                if cluster_created
                else "candidate_cluster_updated"
            ),
            "cluster_id": cluster_id,
            "cluster_status": "candidate",
            "cluster_created": cluster_created,
            "source_report_id": report_id,
            "matched_candidate_count": len(matched_candidates),
            "new_membership_count": len(memberships_to_insert),
            "total_member_count": len(final_memberships),
            "radius_meters": radius_meters,
            "similarity_threshold": similarity_threshold,
            "memberships": final_memberships,
            "human_review_required": True,
            "message": (
                "Potentially related reports grouped for human review. "
                "This cluster is not a confirmed duplicate incident."
            )
        }

    except HTTPException:
        raise

    except Exception as error:
        # If creation succeeded but membership insertion failed,
        # remove the newly created empty/partial candidate cluster.
        if new_cluster_id:
            try:
                db.table("incident_clusters").delete().eq(
                    "id", new_cluster_id
                ).execute()
            except Exception:
                pass

        raise HTTPException(
            status_code=500,
            detail=f"Cluster creation failed: {str(error)}"
        )


@router.get("/clusters")
def list_incident_clusters(
    limit: int = 100,
    current_user: dict = Depends(require_admin)
):
    if limit < 1 or limit > 500:
        raise HTTPException(
            status_code=400,
            detail="Limit must be between 1 and 500."
        )

    db = get_supabase()

    try:
        cluster_result = (
            db.table("incident_clusters")
            .select("id,title,category,status,created_at")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )

        clusters = cluster_result.data or []

        if not clusters:
            return {
                "status": "success",
                "count": 0,
                "clusters": []
            }

        cluster_ids = [
            item["id"] for item in clusters
        ]

        membership_result = (
            db.table("cluster_members")
            .select("cluster_id,report_id")
            .in_("cluster_id", cluster_ids)
            .execute()
        )

        counts = {}

        for membership in membership_result.data or []:
            cluster_key = str(membership["cluster_id"])
            counts[cluster_key] = counts.get(cluster_key, 0) + 1

        for cluster in clusters:
            cluster["member_count"] = counts.get(
                str(cluster["id"]), 0
            )

        return {
            "status": "success",
            "count": len(clusters),
            "clusters": clusters
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Cluster listing failed: {str(error)}"
        )


@router.get("/clusters/{cluster_id}")
def get_incident_cluster(
    cluster_id: str,
    current_user: dict = Depends(require_admin)
):
    cluster_id = validate_uuid(cluster_id, "cluster ID")
    db = get_supabase()

    try:
        cluster_result = (
            db.table("incident_clusters")
            .select("id,title,category,status,created_at")
            .eq("id", cluster_id)
            .limit(1)
            .execute()
        )

        if not cluster_result.data:
            raise HTTPException(
                status_code=404,
                detail="Incident cluster not found."
            )

        cluster = cluster_result.data[0]

        membership_result = (
            db.table("cluster_members")
            .select(
                "report_id,similarity_score,distance_meters,added_at"
            )
            .eq("cluster_id", cluster_id)
            .execute()
        )

        memberships = membership_result.data or []

        report_ids = [
            item["report_id"] for item in memberships
        ]

        reports_by_id = {}

        if report_ids:
            reports_result = (
                db.table("reports")
                .select(
                    "id,title,description,category,status,"
                    "location_text,latitude,longitude,created_at"
                )
                .in_("id", report_ids)
                .execute()
            )

            reports_by_id = {
                str(item["id"]): item
                for item in (reports_result.data or [])
            }

        members = []

        for membership in memberships:
            report = reports_by_id.get(
                str(membership["report_id"])
            )

            if report:
                members.append({
                    "report": report,
                    "similarity_score": membership["similarity_score"],
                    "distance_meters": membership["distance_meters"],
                    "added_at": membership["added_at"]
                })

        return {
            "status": "success",
            "cluster": cluster,
            "member_count": len(members),
            "members": members,
            "human_review_required": cluster["status"] == "candidate"
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Cluster retrieval failed: {str(error)}"
        )
