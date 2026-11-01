
import os
import math

from google import genai
from google.genai import types


def generate_report_embedding(text: str) -> list[float]:
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        raise ValueError("GEMINI_API_KEY is not configured.")

    client = genai.Client(api_key=api_key)

    response = client.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
        config=types.EmbedContentConfig(
            task_type="SEMANTIC_SIMILARITY",
            output_dimensionality=768
        )
    )

    if not response.embeddings:
        raise ValueError("Gemini returned no embeddings.")

    values = response.embeddings[0].values

    # Normalize the 768-dimensional vector.
    magnitude = math.sqrt(sum(value * value for value in values))

    if magnitude == 0:
        raise ValueError("Generated embedding has zero magnitude.")

    normalized = [float(value / magnitude) for value in values]

    if len(normalized) != 768:
        raise ValueError(
            f"Expected 768 dimensions, received {len(normalized)}."
        )

    return normalized
