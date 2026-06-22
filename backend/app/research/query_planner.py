from app.models.questionnaire import Questionnaire
from app.orchestrator.dispatcher import _route_experts
from app.skills.skill_network import skill_label
from app.skills.scenario_catalog import render_problem_text

from .models import ResearchQuery


MAX_QUERIES_PER_MODULE = 5


def plan_system_research_queries(questionnaire: Questionnaire) -> list[ResearchQuery]:
    """Generate system pre-research queries before expert diagnosis.

    第一版用确定性规则，不额外消耗 LLM token。后续可升级为 planner Skill。
    """
    problem_map = questionnaire.problem_map or {}
    problem_text = render_problem_text(problem_map)
    company = str(problem_map.get("company_name") or "").strip()
    industry = str(problem_map.get("industry") or "").strip()
    business = str(problem_map.get("main_business") or "").strip()
    core = str(problem_map.get("core_problem") or "").strip()
    routes = _route_experts(questionnaire)
    modules = [route.answer.module for route in routes]
    if not modules:
        modules = [answer.module for answer in questionnaire.answers[:3]]

    common_terms = " ".join(x for x in [company, industry, business, core] if x)
    queries: list[ResearchQuery] = []

    for module in modules[:8]:
        label = skill_label(module)
        seeds = _module_query_templates(module, label, common_terms, problem_text)
        for query, purpose in seeds[:MAX_QUERIES_PER_MODULE]:
            cleaned = " ".join(query.split())
            if cleaned:
                queries.append(ResearchQuery(module=module, query=cleaned, purpose=purpose))

    return _dedupe_queries(queries)


def _module_query_templates(
    module: str,
    label: str,
    common_terms: str,
    problem_text: str,
) -> list[tuple[str, str]]:
    base = common_terms or problem_text[:120] or label
    generic = [
        (f"{base} 行业趋势 经营指标 基准", "获取行业基准与趋势"),
        (f"{base} 竞品 案例 商业模式", "识别竞品与可比案例"),
        (f"{base} 政策 监管 风险", "核验政策与监管风险"),
    ]
    module_specific: dict[str, list[tuple[str, str]]] = {
        "market": [
            (f"{base} 市场规模 用户需求 竞品定位", "判断市场与客户需求"),
            (f"{base} 渠道投放 获客成本 转化率", "寻找渠道效率基准"),
        ],
        "sales": [
            (f"{base} 销售漏斗 转化率 成交周期 行业基准", "寻找销售漏斗对标"),
            (f"{base} CRM 线索转化 跟进效率", "核验销售承接问题"),
        ],
        "product": [
            (f"{base} 产品评价 用户反馈 痛点", "抓取公开产品反馈"),
            (f"{base} 产品定价 功能 对比", "寻找产品与价格对标"),
        ],
        "ops": [
            (f"{base} 供应链 交付 运营效率 行业基准", "核验运营效率"),
        ],
        "finance": [
            (f"{base} 毛利率 现金流 回本周期 行业基准", "核验财务指标"),
        ],
        "legal_compliance": [
            (f"{base} 法规 合规 处罚 案例", "核验合规红线"),
            (f"{base} 平台规则 广告法 合规要求", "核验平台与广告合规"),
        ],
        "tax": [
            (f"{base} 税务 风险 发票 合规", "核验税务风险"),
        ],
        "policy": [
            (f"{base} 政策 补贴 准入 监管", "核验政策机会与约束"),
        ],
        "ip": [
            (f"{base} 商标 专利 知识产权 风险", "核验知识产权风险"),
        ],
        "supply_chain": [
            (f"{base} 供应链 成本 交付 替代供应商", "核验供应链风险"),
        ],
        "channel_franchise": [
            (f"{base} 招商 加盟 单店模型 回本周期", "核验招商加盟模型"),
            (f"{base} 经销商 渠道 动销率 库存", "核验渠道健康度"),
        ],
        "data_systems": [
            (f"{base} 数据看板 CRM ERP 指标口径", "核验数据系统成熟度"),
        ],
    }
    return [*(module_specific.get(module, [])), *generic]


def _dedupe_queries(queries: list[ResearchQuery]) -> list[ResearchQuery]:
    seen: set[tuple[str, str]] = set()
    out: list[ResearchQuery] = []
    for query in queries:
        key = (query.module, query.query)
        if key in seen:
            continue
        seen.add(key)
        out.append(query)
    return out
