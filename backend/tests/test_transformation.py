"""V2 改造方案生成器测试（按域一一对应）：
- 每个诊断问题各生成一个改造,锚定 = 该 module 的 problem(不复述)。
- before_after / stages 解析到位;某域 LLM 失败优雅降级(generated=False),不影响其他域。
"""
import json

from app.db.models import DiagnosisRecord, Project
from app.models.questionnaire import Questionnaire
from app.models.result import AuditTrail, EvidencePackage, ModuleResult
from app.transformation.generator import (
    build_all_domain_transformations,
    build_domain_transformation,
)


def _setup(results: list[ModuleResult]) -> tuple[Project, DiagnosisRecord]:
    q = Questionnaire(
        project_id="p1",
        answers=[],
        problem_map={"company_name": "GGOO", "industry": "AI API", "goal": "把开发者拉起来"},
    )
    project = Project(id="p1", user_id="u1", name="GGOO")
    record = DiagnosisRecord(
        id="r1",
        project_id="p1",
        session_id="s1",
        answers_json=q.model_dump_json(),
        results_json=json.dumps([r.model_dump() for r in results]),
        review_status="approved",
    )
    return project, record


def _result(module: str, signal: str, problem: str, conclusion: str) -> ModuleResult:
    return ModuleResult(
        module=module, signal=signal, problem=problem, conclusion=conclusion,  # type: ignore[arg-type]
        evidence=[], actions=["x"],
        evidence_package=EvidencePackage(
            confidence=0.5, confidence_reason="r", citations=[], benchmarks=[],
            audit_trail=AuditTrail(skill_version_id="v1", input_modules=[module]),
        ),
    )


def _good_json(module: str) -> str:
    return json.dumps({
        "redesign_headline": f"30 天，把{module}这个环节装成自己会跑的机器",
        "before_after": [
            {"dimension": "这个环节怎么运转", "before": "一个人有空才做", "after": "Agent 自动跑"},
            {"dimension": "你的角色", "before": "累死累活干所有活", "after": "每天 30 分钟审战果"},
        ],
        "stages": [{
            "window": "第 1 周", "result": "状态页上线",
            "how": "用 UptimeRobot 挂监控自动出状态页",
            "ai_does": "写报告", "you_do": "点发布",
            "ai_capabilities": ["内容生成", "数据→图表"],
        }],
        "investment": "月几百块工具费 + 你每天 30 分钟，不招人、不写代码。",
        "prereq_risk": "AI 只放大事实不掩盖宕机；产品本身得过得去。",
    }, ensure_ascii=False)


class _FakeLLM:
    """按 target_problem.module 返回对应内容;module 在 fail_modules 里则抛错(模拟单域失败)。"""
    def __init__(self, fail_modules: set[str] | None = None):
        self.fail_modules = fail_modules or set()

    async def complete(self, system: str, prompt: str) -> str:
        data = json.loads(prompt)
        module = data["target_problem"]["module"]
        if module in self.fail_modules:
            raise RuntimeError("gateway 503")
        return _good_json(module)


async def test_each_problem_gets_its_own_transformation():
    project, record = _setup([
        _result("market", "red", "20 个注册仅 1 人在调用", "渠道结构错配"),
        _result("product", "yellow", "缺稳定性证据", "信任短板"),
        _result("finance", "green", "现金流健康但无沉淀", "财务尚可"),
    ])
    plan = await build_all_domain_transformations(project, record, _FakeLLM())
    # 每个有诊断结论的问题(含 green,只要有 problem/conclusion)都出改造
    assert set(plan.items.keys()) == {"market", "product", "finance"}
    market = plan.items["market"]
    # 锚定 = 该 module 的 problem 原文(回显,不复述)
    assert market.module == "market"
    assert "20 个注册仅 1 人" in market.problem
    # 结果层 + 实现层解析到位
    assert any(r.dimension == "你的角色" for r in market.before_after)
    assert market.stages[0].window == "第 1 周"
    assert "UptimeRobot" in market.stages[0].how
    assert market.generated is True


async def test_single_domain_failure_isolated():
    project, record = _setup([
        _result("market", "red", "渠道问题", "渠道错配"),
        _result("product", "yellow", "产品问题", "信任短板"),
    ])
    # market 失败,product 正常 → market 降级、product 不受影响
    plan = await build_all_domain_transformations(project, record, _FakeLLM(fail_modules={"market"}))
    assert plan.items["market"].generated is False
    assert plan.items["product"].generated is True
    assert plan.items["product"].before_after  # 其他域照常出内容


async def test_build_one_domain():
    project, record = _setup([_result("market", "red", "渠道问题", "渠道错配")])
    item = await build_domain_transformation(project, record, "market", _FakeLLM())
    assert item is not None
    assert item.module == "market"
    assert item.redesign_headline
    # 不存在的域返回 None
    assert await build_domain_transformation(project, record, "nonexist", _FakeLLM()) is None
