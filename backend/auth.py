
import os

from dotenv import load_dotenv
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Supabase environment variables are not configured.")

# This client stays on the backend and uses the secret key.
supabase_auth: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication required.",
        )

    token = credentials.credentials

    try:
        # Supabase verifies the access token and returns the actual user.
        response = supabase_auth.auth.get_user(token)
        user = response.user

        if user is None:
            raise HTTPException(
                status_code=401,
                detail="Invalid or expired access token.",
            )

        # Read the role from the protected database profile.
        profile_response = (
            supabase_auth.table("profiles")
            .select("id, full_name, role")
            .eq("id", str(user.id))
            .single()
            .execute()
        )

        profile = profile_response.data

        if not profile:
            raise HTTPException(
                status_code=403,
                detail="User profile not found.",
            )

        return {
            "id": str(user.id),
            "email": user.email,
            "full_name": profile.get("full_name"),
            "role": profile.get("role"),
        }

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Authentication failed. Please sign in again.",
        )


def require_admin(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="Administrator access required.",
        )

    return current_user
