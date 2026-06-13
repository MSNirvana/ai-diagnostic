from app.skills.base import Skill
from app.skills.finance import FinanceSkill
from app.skills.market import MarketSkill
from app.skills.ops import OpsSkill
from app.skills.org import OrgSkill
from app.skills.product import ProductSkill
from app.skills.sales import SalesSkill

_SKILLS: dict[str, Skill] = {
    "market": MarketSkill(),
    "product": ProductSkill(),
    "sales": SalesSkill(),
    "ops": OpsSkill(),
    "org": OrgSkill(),
    "finance": FinanceSkill(),
}


def get_skill(module: str) -> Skill | None:
    return _SKILLS.get(module)


def registered_modules() -> list[str]:
    return list(_SKILLS.keys())
