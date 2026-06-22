import json
import re

from app.db.models import DiagnosisSession
from app.models.conversation import ChatMessage


def clean_session_title(text: str) -> str:
    title = re.sub(r"\s+", " ", text).strip(" ，,。.!！?？、；;：:\"“”'‘’（）()[]【】")
    title = re.sub(
        r"^(你好|您好|哈喽|hello|hi|我是|我们是|我想|我现在|现在|目前|主要是|问题是)[，,\s：:]*",
        "",
        title,
        flags=re.IGNORECASE,
    )
    title = re.sub(r"^(一个|一家|做|卖|通过|关于)[，,\s：:]*", "", title)
    title = title.strip(" ，,。.!！?？、；;：:\"“”'‘’（）()[]【】")
    if not title:
        return ""
    for sep in ("。", "？", "?", "！", "!", "；", ";"):
        if sep in title:
            title = title.split(sep, 1)[0].strip()
    return title[:24]


def title_from_history(history: list[ChatMessage], problem_map: object | None = None) -> str:
    core_problem = getattr(problem_map, "core_problem", "") if problem_map is not None else ""
    if core_problem:
        return clean_session_title(str(core_problem))
    user_messages = [m.content for m in history if m.role == "user" and m.content.strip()]
    for content in reversed(user_messages[:3]):
        title = clean_session_title(content)
        if len(title) >= 4:
            return title
    if user_messages:
        return clean_session_title(user_messages[0]) or "问题定位"
    return "问题定位"


def display_session_title(session: DiagnosisSession) -> str:
    if session.title.strip():
        return session.title
    try:
        problem_map = json.loads(session.problem_map_json) if session.problem_map_json else {}
        if isinstance(problem_map, dict):
            core_problem = str(problem_map.get("core_problem") or "").strip()
            if core_problem:
                return clean_session_title(core_problem) or "问题定位记录"
        history = [ChatMessage.model_validate(m) for m in json.loads(session.messages_json)]
    except (TypeError, ValueError):
        history = []
    return title_from_history(history) or "问题定位记录"
