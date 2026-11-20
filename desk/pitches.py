import json
from urllib.error import URLError
from urllib.request import Request, urlopen

from django.conf import settings

RESPONSES_URL = "https://api.openai.com/v1/responses"
LANGUAGES = ("english", "hindi")


class PitchUnavailable(Exception):
    pass


def generate_pitch(category):
    request = Request(
        RESPONSES_URL,
        data=json.dumps({
            "model": settings.OPENAI_PITCH_MODEL,
            "store": False,
            "max_output_tokens": 650,
            "instructions": (
                "Write two versions of the same short, natural, spoken opening pitch "
                "for a field representative introducing a business current account. "
                "Tailor the opening question to the likely daily payment or deposit "
                "workflow of the supplied business category, without assuming the "
                "business has that workflow. Use a polite introduction, one discovery "
                "question, and a low-pressure next step. Use 2–3 short sentences in "
                "each language. Write Hindi in Devanagari using respectful आप. "
                "Do not invent fees, rates, offers, eligibility, or guaranteed benefits."
            ),
            "input": f"Business category: {category}",
            "text": {"format": {
                "type": "json_schema", "name": "lead_pitch", "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {language: {"type": "string"} for language in LANGUAGES},
                    "required": list(LANGUAGES),
                    "additionalProperties": False,
                },
            }},
        }).encode("utf-8"),
        headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=12) as response:
            result = json.load(response)
        if result.get("status") != "completed":
            raise ValueError("Incomplete response")
        output = "".join(
            part["text"] for message in result["output"] if message["type"] == "message"
            for part in message["content"] if part["type"] == "output_text"
        )
        parsed = json.loads(output)
        pitches = {language: parsed[language].strip() for language in LANGUAGES}
        if any(not pitch or len(pitch) > 600 for pitch in pitches.values()):
            raise ValueError("Invalid pitch length")
        if not any("\u0900" <= char <= "\u097f" for char in pitches["hindi"]):
            raise ValueError("Hindi pitch was not returned in Devanagari")
        return pitches
    except (URLError, OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
        raise PitchUnavailable from exc
