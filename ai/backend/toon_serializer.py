"""TOON serialization utility for NETAct copilot.

Compresses tabular/structured JSON-like lists and dicts into the highly compact
TOON (Tabular Object Oriented Notation) format, achieving 40-60% token savings.
Falls back to JSON on any serialization or import error.
"""

import json
import logging
from typing import Any

logger = logging.getLogger("toon_serializer")

def serialize_response(data: Any) -> dict:
    """Serialize structured data to TOON format with JSON fallback.

    Args:
        data: Any JSON-serializable data structure.

    Returns:
        dict: {
            "toon_data": str,       # Serialized string (TOON or JSON)
            "fallback_used": bool   # True if JSON fallback was used
        }
    """
    try:
        import toon
        toon_str = toon.dumps(data)
        return {
            "toon_data": toon_str,
            "fallback_used": False
        }
    except ImportError:
        logger.debug("toon-format package is not installed; falling back to JSON")
        return {
            "toon_data": json.dumps(data, indent=2, default=str),
            "fallback_used": True
        }
    except Exception as e:
        logger.warning("TOON serialization failed (%s: %s); falling back to JSON", type(e).__name__, e)
        return {
            "toon_data": json.dumps(data, indent=2, default=str),
            "fallback_used": True
        }
