import os
import json
import logging

logger = logging.getLogger("config-loader")

_RULES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rules_config.json")
_PROMPTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts.json")

_rules_cache_holder = [{}]
_rules_mtime_holder = [0.0]
_prompts_cache_holder = [{}]
_prompts_mtime_holder = [0.0]


def _load_json(path, cache_ref, mtime_ref):
    """Generic hot-reload loader. Reloads automatically when the file changes on disk."""
    if not os.path.exists(path):
        logger.warning("Config file not found: %s", path)
        return cache_ref[0]
    try:
        mtime = os.path.getmtime(path)
        if mtime > mtime_ref[0]:
            logger.info("(Re)loading %s", path)
            with open(path, "r", encoding="utf-8") as f:
                cache_ref[0] = json.load(f)
            mtime_ref[0] = mtime
    except Exception as e:
        logger.error("Failed to load %s: %s", path, e)
    return cache_ref[0]


def load_rules_config():
    return _load_json(_RULES_FILE, _rules_cache_holder, _rules_mtime_holder)


def load_prompts():
    return _load_json(_PROMPTS_FILE, _prompts_cache_holder, _prompts_mtime_holder)


def get_prompt(key, default=""):
    """Returns a prompt template by key from prompts.json. Hot-reloaded on file change."""
    return load_prompts().get(key, default)


# ---------------------------------------------------------------------------
# rules_config.json accessors (keywords, routing rules -- NOT prompts)
# ---------------------------------------------------------------------------

def get_agent_fast_path_keywords():
    return load_rules_config().get("agent_fast_path_keywords", {})


def get_app_intent_classifier_system_prompt():
    """Intent classifier prompt -- reads from prompts.json, falls back to rules_config.json."""
    return get_prompt("intent_classifier") or load_rules_config().get("app_intent_classifier_system_prompt", "")


def get_app_audit_keywords():
    return load_rules_config().get("app_audit_keywords", {})


# ---------------------------------------------------------------------------
# Legacy compatibility wrappers -- callers that still use dict-style access.
# Both now read from prompts.json via get_prompt().
# ---------------------------------------------------------------------------

def get_agent_prompts():
    """Deprecated: use get_prompt(key) directly. Kept for backwards compatibility."""
    return {
        "response_synthesizer": get_prompt("telemetry_synthesis"),
        "general_chat": get_prompt("general_chat"),
    }


def get_app_audit_prompts():
    """Deprecated: use get_prompt(key) directly. Kept for backwards compatibility."""
    return {
        "git_history": get_prompt("git_history"),
        "git_diff": get_prompt("git_diff"),
        "general_conversational": get_prompt("mop_conversational"),
        "mop_audit": get_prompt("mop_audit"),
        "gemini_mop_rag": get_prompt("gemini_mop_rag"),
    }
