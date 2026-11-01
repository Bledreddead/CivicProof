
import os
from typing import Literal

from google import genai
from google.genai import types
from pydantic import BaseModel, Field


class CivicIssueAnalysis(BaseModel):
    category: Literal[
        "road", "water", "garbage",
        "drainage", "streetlight", "other", "unclear"
    ]

    asset_type: str
    issue_summary: str

    observations: list[str]
    severity: int = Field(ge=1, le=5)
    severity_reason: str

    potential_risks: list[str]
    missing_information: list[str]

    confidence: float = Field(ge=0, le=1)
    requires_human_review: bool
    limitations: list[str]


def analyze_civic_image(
    image_bytes: bytes,
    mime_type: str,
    description: str
) -> dict:

    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is missing.")

    client = genai.Client(api_key=api_key)

    prompt = f"""
You are the visual evidence analysis engine of CivicProof,
a civic infrastructure reporting platform.

Analyse the attached photograph and the citizen's description.

Citizen description:
{description}

Your responsibilities:

1. Identify the most likely civic issue category.
2. Identify the infrastructure asset involved.
3. Describe only what is visibly supported by the image.
4. Assign severity from 1 to 5:
   1 = minor
   2 = low
   3 = moderate
   4 = high
   5 = potentially critical
5. Explain why you assigned that severity.
6. Identify potential risks, without claiming they have occurred.
7. List information that cannot be established from this photograph.
8. Estimate your confidence in the visual interpretation.
9. Flag cases requiring human inspection.

STRICT RULES:

- Never invent an observation.
- Never assume the location from the photograph.
- Never claim an issue is officially verified.
- Do not identify people in the photograph.
- If the image is unclear or unrelated to civic infrastructure,
  use category "unclear" or "other" as appropriate.
- Low visual evidence must result in lower confidence.
- Always explain uncertainty.
- A photograph alone cannot establish the complete extent
  or cause of infrastructure damage.

Return the result using the requested structured schema.
"""

    image_part = types.Part.from_bytes(
        data=image_bytes,
        mime_type=mime_type
    )

    response = client.models.generate_content(
        model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        contents=[prompt, image_part],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=CivicIssueAnalysis,
            temperature=0.2
        )
    )

    if not response.text:
        raise RuntimeError("Gemini returned an empty response.")

    analysis = CivicIssueAnalysis.model_validate_json(response.text)

    return analysis.model_dump()
