from abc import ABC, abstractmethod
from sqlalchemy.ext.asyncio import AsyncSession
from app.llm.base import LLMClient
from app.models.questionnaire import ModuleAnswer
from app.models.result import ModuleResult


class Skill(ABC):
    """专家 skill 契约：只规定边界，不规定内部方法。

    子类声明 module（模块归属）和 method（自声明方法类型，
    如 hypothesis/metrics/framework/process）。内部怎么诊断由子类自由实现，
    全部在服务端执行——这是护城河。

    diagnose 返回 (ModuleResult, skill_version_id)：version_id 标记本次用了
    哪个 skill 版本，"fallback" 表示用了代码里的兜底 prompt（DB 无激活版本）。
    """

    module: str
    method: str

    @abstractmethod
    async def diagnose(
        self,
        answer: ModuleAnswer,
        llm: LLMClient,
        session: AsyncSession | None = None,
    ) -> tuple[ModuleResult, str]:
        ...
