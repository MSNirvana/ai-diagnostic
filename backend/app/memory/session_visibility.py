import json

from app.db.models import DiagnosisSession


def is_meaningful_session(session: DiagnosisSession) -> bool:
    """Only sessions with real user progress should appear in archives."""
    if session.problem_map_json or session.diagnosis_record_id or session.draft_json:
        return True
    if session.status in {"confirmed", "filling", "diagnosed"}:
        return True
    try:
        return len(json.loads(session.messages_json)) > 0
    except (TypeError, ValueError):
        return False
