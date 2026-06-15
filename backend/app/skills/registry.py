from app.skills.base import Skill
from app.skills.configured import ConfiguredExpertSkill
from app.skills.config_loader import list_config_keys, load_config
from app.skills.finance import FinanceSkill
from app.skills.market import MarketSkill
from app.skills.ops import OpsSkill
from app.skills.org import OrgSkill
from app.skills.product import ProductSkill
from app.skills.sales import SalesSkill
from app.skills.skill_network import (
    SPECIALIST_CONFIGS,
    SkillDefinition,
    diagnosis_skill_definitions,
    skill_definition,
)


def _load_configured_skills() -> dict[str, Skill]:
    """加载 configs/ 目录下 Loop 1 产出的 skill（文件即上线，无需改代码）。"""
    skills: dict[str, Skill] = {}
    for key in list_config_keys():
        try:
            skills[key] = ConfiguredExpertSkill(load_config(key))
        except Exception:  # noqa: BLE001 — 单个坏配置不应拖垮整个 registry
            continue
    return skills


_SKILLS: dict[str, Skill] = {
    "market": MarketSkill(),
    "product": ProductSkill(),
    "sales": SalesSkill(),
    "ops": OpsSkill(),
    "org": OrgSkill(),
    "finance": FinanceSkill(),
    **{
        key: ConfiguredExpertSkill(config)
        for key, config in SPECIALIST_CONFIGS.items()
    },
    # configs/ 目录的文件型 skill 最后加载，可覆盖同名内置（便于迭代）
    **_load_configured_skills(),
}


def get_skill(module: str) -> Skill | None:
    return _SKILLS.get(module)


def registered_modules() -> list[str]:
    return list(_SKILLS.keys())


def registered_skill_definitions() -> list[SkillDefinition]:
    return [definition for definition in diagnosis_skill_definitions() if definition.key in _SKILLS]


def get_skill_definition(module: str) -> SkillDefinition | None:
    return skill_definition(module)
