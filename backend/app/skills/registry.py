from app.skills.base import Skill
from app.skills.generic import GenericModuleSkill
from app.skills.market import MarketSkill

_SKILLS: dict[str, Skill] = {
    "market": MarketSkill(),
    "product": GenericModuleSkill("product"),
    "sales": GenericModuleSkill("sales"),
    "ops": GenericModuleSkill("ops"),
    "org": GenericModuleSkill("org"),
    "finance": GenericModuleSkill("finance"),
}


def get_skill(module: str) -> Skill | None:
    return _SKILLS.get(module)


def registered_modules() -> list[str]:
    return list(_SKILLS.keys())
