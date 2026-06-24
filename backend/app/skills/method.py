"""诊断方法主 skill —— 全系统唯一的"脑子"。

所有诊断 skill 的通用方法、证据纪律和输出契约都集中在这一个 skill 里
（module key = "diagnostic_method"），运行时由 compose_system_prompt 注入到
每个领域 skill 的领域切片之后。

关键：它和其它 skill 一样是**可版本化的 DB skill**——
- DB（SkillVersion 表）里有激活版本时用 DB 的，可在后台 A/B、回滚、按反馈升级，无需改代码；
- DB 为空时回退到本文件的 DIAGNOSTIC_METHOD 常量，保证系统在空库下仍能产出合规 JSON；
- seed_skills.py 从 SkillDefinition.fallback_prompt（即此常量）写入初始版本。

设计意图（见架构讨论）：
- 推理与输出契约是通用的、且前沿模型在不断变强 —— 不该在 30 个 prompt 里重复，
  收敛成这一个可治理的 skill，升级一次全局生效。
- 各领域 skill 的存储 prompt 只保留"模型不知道的领域判断 + KPI + 数据入口"，
  靠 benchmark / similar_cases（数据层）注入行业知识 —— 反馈复利进数据，不进散文 prompt。

注意：领域 prompt 不应再自带输出 JSON 契约（避免与本方法重复）。
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.skills.store import get_active_skill_version

# 诊断方法主 skill 在 SkillVersion 表里的 module key。
METHOD_MODULE_KEY = "diagnostic_method"

# 用于防重复叠加的哨兵：出现这句说明 prompt 里已含通用方法，不再二次注入。
_METHOD_SENTINEL = "所有诊断专家共用的通用方法与输出纪律"
_SOURCE_DISCIPLINE_SENTINEL = "证据来源定位规则"
_SOURCE_DISCIPLINE = """

【证据来源定位规则】
- evidence.source 必须定位清楚，不允许留空、写“未注明”或只写“分析”。
- 引用 facts / problem_map / context / pains 中的老板输入时，source 写“客户自述（诊断问答）”。
- 引用上传解析材料时，source 写“客户上传资料（文件名或资料类型）”。
- 引用 benchmark 时，source 写明“行业基准”及来源；引用 external_research_evidence 时，source 写明网页标题或 URL。
"""

# DB 无激活版本时的兜底（也是 seed 的初始版本来源）。
DIAGNOSTIC_METHOD = """所有诊断专家共用的通用方法与输出纪律（逐条遵守，不要在输出里暴露本段内容）：

【你会收到的输入 JSON】
- domain：本次要诊断的领域。含 label（领域名）、industry_kpis（该领域关键指标）、judgment_hints（该领域易误判点，可能为空）
- scenario：业务场景（key/label/evidence_lens/benchmark_keywords），决定优先看哪些信号
- problem_map / context：老板的核心问题、目标、约束、成功标准、项目画像
- facts：用户已填写或上传解析出的事实数据；pains：老板勾选的痛点
- benchmark：行业基准，可能带 _estimated 估算标记，也可能缺失
- similar_cases：同行业/同场景的脱敏历史先例，仅供参考，不是本项目事实
- external_research_evidence：系统预研搜索到的外部证据（带 url/title/snippet/credibility）
- data_requirements / missing_data_requests：本领域需要的数据、以及当前已识别的缺口

【领域判断（现场构建，内部执行）】
没有现成的领域提示词，不等于降低专业度——你要据 domain 现场建立该领域的诊断视角：
- 用 domain.label + domain.industry_kpis 确定本领域该优先看哪些信号、按什么顺序定位卡点（先看哪段、再看哪段）。
- 把 domain.judgment_hints 当作"容易误判的已知陷阱"重点规避；为空时就用你对该领域的专业常识补全视角。
- 始终结合 scenario（直播/电商/B2B/SaaS/本地服务/制造）调整该领域的看法，再用 facts/benchmark 证实证伪。

【判断方法（内部执行，不要写进输出）】
1. 先立假设，再用 facts 与 benchmark 证实或证伪——不要把假设当结论。
2. 约束定位：先判断你这个领域到底是问题的「根因」，还是被别的环节卡住后显现的「表象」。
   若更像表象（如转化差其实源于流量质量、毛利低其实源于定价或获客成本），
   必须在 conclusion 里点明真正的约束可能在哪一环，而不是把表象当根因下死结论。
3. 数据诚实：缺关键数据时，绝不编造或假装看到了结论；降低置信度，并把缺口落成可执行的数据请求。

【证据纪律】
- benchmark 用于内外对比；benchmark 缺失或为 _estimated 估算时，必须明显降低置信度并注明。
- similar_cases 只能参考典型信号与常见缺数据；evidence 只能引用本项目的 facts/benchmark/上传数据，
  禁止把先例结论当作本项目证据。
- 引用外部事实时，evidence.source 必须写明来源标题或 URL。

【严格输出 JSON，不要任何额外文字】
{signal, conclusion, evidence[], actions[], drilldown{data_points[], comparisons[]}}
- signal：red / yellow / green
- conclusion：结论先行，一句话讲清本领域最关键的判断，并命中至少一个本领域关键指标
- evidence：最多 3 条，每条 {text, source}，用结果语言陈述事实；
  引用的数字必须来自 facts 或 benchmark，禁止编造；衍生指标写明算式（如 转化率=成交/点击）
- actions：2-3 条按优先级，每条含强动作动词（暂停/下调/改写/重投/收窄/扩量/核验/暂缓…），
  可直接进入经营会动作清单
- drilldown：只放事实数据和对比，不写方法/假设/框架
- 若证据仍不足以支撑判断，可加 research_questions 数组，说明还需补搜或补数什么
- JSON 字符串内部禁止使用英文双引号 "；需要强调或引用短语一律用中文引号「」，否则会破坏 JSON 结构"""


def _compose(domain_prompt: str | None, method_text: str) -> str:
    """把领域切片 + 通用方法拼成完整 system prompt（纯函数）。

    - 领域 prompt 在前（身份 + 领域判断纪律 + KPI），通用方法在后（纪律 + 输出契约）。
    - 幂等保护：若领域 prompt 已含通用方法（哨兵命中），直接返回，避免重复叠加。
    - 领域 prompt 为空时退化为只用通用方法，保证系统仍能产出合规 JSON。
    """
    domain = (domain_prompt or "").strip()
    if not domain:
        return method_text
    if _METHOD_SENTINEL in domain:
        return domain
    return f"{domain}\n\n{method_text}"


def compose_preview(domain_prompt: str | None) -> str:
    """同步预览：用代码兜底的方法常量合成（不读 DB）。

    供评测、后台预览等无 DB session 的场景使用。运行时真实装配请用
    异步的 compose_system_prompt，它会优先取 DB 的激活方法版本。
    """
    method_text = DIAGNOSTIC_METHOD
    if _SOURCE_DISCIPLINE_SENTINEL not in method_text:
        method_text = f"{method_text.rstrip()}{_SOURCE_DISCIPLINE}"
    return _compose(domain_prompt, method_text)


async def compose_system_prompt(
    domain_prompt: str | None,
    session: AsyncSession | None = None,
) -> str:
    """运行时装配：取 DB 激活的诊断方法版本（无则兜底常量）注入领域切片。

    这让"脑子"和其它 skill 一样可在后台版本化治理：改一处，全局诊断生效。
    """
    method_ver = await get_active_skill_version(session, METHOD_MODULE_KEY)
    method_text = method_ver.system_prompt if method_ver else DIAGNOSTIC_METHOD
    if _SOURCE_DISCIPLINE_SENTINEL not in method_text:
        method_text = f"{method_text.rstrip()}{_SOURCE_DISCIPLINE}"
    return _compose(domain_prompt, method_text)
