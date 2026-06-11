from app.skills.base import Skill
from app.skills.market import MarketSkill

_SKILLS: dict[str, Skill] = {
    "market": MarketSkill(),
}


def get_skill(module: str) -> Skill | None:
    return _SKILLS.get(module)


def registered_modules() -> list[str]:
    return list(_SKILLS.keys())
