"""Seed five end-to-end consulting test cases for the active demo account.

This script writes realistic project/session/diagnosis/memory/war-room data into
local SQLite so the product can be inspected without relying on a live LLM key.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from app.db.database import AsyncSessionLocal, init_db
from app.db.models import (
    DiagnosisFeedback,
    DiagnosisRecord,
    DiagnosisSession,
    Project,
    ProjectMemoryEntry,
    SkillVersion,
    User,
)
from app.models.questionnaire import ModuleAnswer, Questionnaire
from app.models.result import (
    AuditTrail,
    BenchmarkReference,
    DataRequest,
    DrillDown,
    Evidence,
    EvidencePackage,
    ExpertRoute,
    ModuleResult,
    TriageConflict,
    TriageSummary,
)
from app.models.warroom import WarRoomPlan
from app.warroom.composer import compose_war_room_plan
from app.warroom.history import apply_project_war_room_iteration

TARGET_EMAIL = "msnirvana@hotmail.com"
PREFIX = "[系统测试]"


def now() -> datetime:
    return datetime.now(timezone.utc)


def sentence(text: str) -> str:
    text = " ".join(str(text or "").split()).strip("；;，, ")
    if not text:
        return ""
    return text if text[-1] in "。！？.!?" else f"{text}。"


def confidence_for(*, source_quality: int, data_completeness: int, benchmark: int, recency: int, missing_required: int) -> tuple[float, str]:
    score = 0.28 * source_quality + 0.26 * data_completeness + 0.2 * benchmark + 0.16 * recency + 0.1 * max(0, 100 - missing_required * 18)
    score = max(35, min(96, round(score)))
    reason = (
        f"来源质量{source_quality}/100，数据完整度{data_completeness}/100，"
        f"外部基准{benchmark}/100，时效性{recency}/100，关键缺口{missing_required}项；"
        f"综合校准为{score}%。"
    )
    return score / 100, reason


def ev(text: str, source: str) -> Evidence:
    return Evidence(text=sentence(text), source=source)


def req(key: str, label: str, reason: str, hint: str, required: bool = True) -> DataRequest:
    return DataRequest(key=key, label=label, reason=sentence(reason), source_hint=hint, required=required)


def ep(module: str, skill_id: str, confidence: float, reason: str, citations: list[Evidence], benchmarks: list[BenchmarkReference], checks: list[str], input_modules: list[str]) -> EvidencePackage:
    return EvidencePackage(
        confidence=confidence,
        confidence_reason=reason,
        citations=citations,
        benchmarks=benchmarks,
        audit_trail=AuditTrail(skill_version_id=skill_id, input_modules=input_modules, checks=checks),
    )


def result(
    *,
    module: str,
    signal: str,
    conclusion: str,
    evidence: list[Evidence],
    actions: list[str],
    skill_ids: dict[str, str],
    source_quality: int,
    data_completeness: int,
    benchmark: int,
    recency: int,
    missing: list[DataRequest] | None = None,
    comparisons: list[str] | None = None,
) -> ModuleResult:
    missing = missing or []
    confidence, reason = confidence_for(
        source_quality=source_quality,
        data_completeness=data_completeness,
        benchmark=benchmark,
        recency=recency,
        missing_required=len([item for item in missing if item.required]),
    )
    benchmarks = [
        BenchmarkReference(name="同类项目经营基准", source="系统测试基准库", value=f"{module} 维度按可验证数据校准。")
    ]
    return ModuleResult(
        module=module,
        signal=signal,  # type: ignore[arg-type]
        conclusion=sentence(conclusion),
        evidence=evidence[:3],
        actions=[sentence(item) for item in actions],
        drilldown=DrillDown(data_points=evidence[:3], comparisons=comparisons or []),
        evidence_package=ep(
            module,
            skill_ids.get(module, f"seed-{module}"),
            confidence,
            reason,
            evidence[:3],
            benchmarks,
            checks=["问题地图一致性检查", "证据来源标注检查", "数据缺口降置信度检查"],
            input_modules=[module, "evidence_confidence"],
        ),
        data_requests=missing,
    )


def triage(primary: str, modules: list[tuple[str, str, int]], conflicts: list[tuple[list[str], str]], deps: list[str], actions: list[str]) -> TriageSummary:
    return TriageSummary(
        primary_module=primary,
        selected_experts=[ExpertRoute(module=m, label=label, reason=reason, priority=p) for p, (m, label, reason) in enumerate(modules, start=1)],
        conflicts=[TriageConflict(modules=mods, description=sentence(desc)) for mods, desc in conflicts],
        dependencies=[sentence(item) for item in deps],
        priority_actions=[sentence(item) for item in actions],
    )


CASES = [
    {
        "name": f"{PREFIX} 华火新能源电火灶商业化攻坚",
        "problem_map": {
            "company_name": "华火新能源",
            "industry": "新能源厨房设备",
            "main_business": "商用电火灶研发、生产与招商代理",
            "business_model": "设备销售 + 区域代理 + 商厨改造方案",
            "scale": "约80人，年营收约3000万",
            "stage": "从样板客户向规模化渠道扩张",
            "core_problem": "产品有节能卖点，但招商转化低、代理复购弱，现金流压力加大",
            "sub_problems": ["代理单元经济模型不清晰", "推广素材缺少真实经营数据", "供应交付与售后承接能力未被验证"],
            "goal": "90天内跑通2个可复制代理样板，并把单月现金流缺口压到可控范围",
            "constraints": "不能继续大额烧投放，不能承诺不确定收益，交付团队有限",
            "success_criteria": "代理成交周期缩短30%，样板客户复购率达到40%，月现金流缺口低于20万",
            "impact": "过去两个月招商线索成本上升约45%，成交率从8%降到3%左右",
            "context": "已有综合调研报告和部分客户案例，但投放账号、代理经营数据、售后记录不完整",
            "suspected_cause": "市场教育成本高，代理收益模型和合规宣传口径没有统一",
            "tried": "做过短视频投放、招商会和区域代理政策调整，但复盘口径不一致",
            "data_readiness": "可提供调研报告、报价表、招商政策，缺少广告后台和代理真实经营流水",
            "diagnosis_focus": "channel_franchise",
            "information_score": 86,
            "missing_fields": ["投放账号后台", "代理门店流水", "售后故障率"],
            "next_question_reason": "需要验证推广线索质量、代理模型和供应交付能力是否闭环",
        },
        "messages": [
            ("user", "我们做电火灶，产品有节能优势，但招商一直不好，代理也不稳定。"),
            ("assistant", "我先把问题收敛为：不是单纯流量少，而是代理是否能赚钱、推广承诺是否可信、交付能否承接三件事没有形成闭环。请确认这个判断。"),
            ("user", "确认，就是这个问题，我们不能再盲目烧钱。"),
        ],
        "answers": [
            ("channel_franchise", {"代理数量": "签约38家，近90天活跃14家", "单代理首批投入": "约8万-15万元", "复购情况": "近三个月复购代理6家", "招商政策": "区域保护、样机补贴、培训支持"}, ["代理转化低", "复购弱"]),
            ("market", {"主要渠道": "短视频投放、招商会、行业展会", "线索成本": "从260元升至380元", "有效线索率": "销售主观判断约22%", "竞品": "燃气灶改造方案、商用电磁灶"}, ["推广账号数据缺失", "卖点解释成本高"]),
            ("finance", {"月固定费用": "约65万元", "毛利率": "设备毛利约34%", "现金流": "近两个月每月缺口约35万元", "账期": "代理回款快，工程客户账期45-90天"}, ["现金流压力", "预算红线不清"]),
            ("legal_compliance", {"宣传口径": "节能30%-50%、低明火风险", "合同": "代理协议有区域保护和培训承诺", "资质": "已有部分检测报告"}, ["宣传承诺需核验", "合同承诺风险"]),
            ("supply_chain", {"关键部件": "控制模块、电热核心件", "供应商": "控制模块主供一家", "交期": "常规15天，旺季25天", "售后": "故障反馈未系统化"}, ["单一供应商", "售后数据缺失"]),
        ],
        "results": "huahuo",
        "feedback": ("channel_franchise", 5, True, "作战室把代理模型、合规宣传和现金流放在一起看，很适合拿去开经营会。"),
    },
    {
        "name": f"{PREFIX} 云链SaaS续费与增长诊断",
        "problem_map": {
            "company_name": "云链协同",
            "industry": "B2B SaaS",
            "main_business": "企业采购协同与合同流程软件",
            "business_model": "订阅收入 + 实施服务费",
            "scale": "约120人，ARR约2600万",
            "stage": "从销售驱动转向续费驱动",
            "core_problem": "新签客户不少，但续费率下降、实施周期拉长，销售和交付互相甩锅",
            "sub_problems": ["线索质量与成交承诺不一致", "产品关键场景使用深度不足", "数据口径不能串联销售到续费"],
            "goal": "两季度内把净收入留存率从82%提升到95%以上",
            "constraints": "不能大幅扩充实施团队，当前版本只能做轻量产品调整",
            "success_criteria": "实施周期压缩20%，续费风险客户提前60天识别，关键功能使用率提升30%",
            "impact": "最近一个季度大客户续费流失4家，影响ARR约420万",
            "context": "CRM、工单、产品埋点分散，客户成功团队靠人工表格维护健康度",
            "suspected_cause": "销售承诺过宽，产品价值没有在首月被客户感知",
            "tried": "做过续费优惠和客户成功回访，但没有提前预警机制",
            "data_readiness": "有CRM导出、工单表、产品使用日志摘要，缺少统一客户健康分",
            "diagnosis_focus": "product",
            "information_score": 90,
            "missing_fields": ["客户健康分口径", "销售承诺清单"],
            "next_question_reason": "需要判断流失主要来自产品价值、销售承诺还是交付承接",
        },
        "messages": [
            ("user", "我们SaaS新签还可以，但续费掉得很厉害，销售说产品不行，产品说销售乱承诺。"),
            ("assistant", "这个问题要按销售承诺、产品激活、交付实施、数据系统四条线一起看，否则只会变成部门互相解释。"),
            ("user", "对，我们要找到能在季度会上拍板的动作。"),
        ],
        "answers": [
            ("product", {"激活率": "首月完成核心流程配置客户约58%", "高频功能": "审批流、供应商协同、合同模板", "流失反馈": "上线慢、价值感弱、报表不够灵活"}, ["价值感不足", "关键功能使用低"]),
            ("sales", {"线索来源": "行业会、老客户转介绍、SEM", "成交周期": "平均63天", "承诺内容": "部分销售承诺深度定制和快速上线", "赢单率": "商机赢单率18%"}, ["承诺边界不清", "线索分层弱"]),
            ("ops", {"实施周期": "中位数47天", "延期原因": "客户数据整理、权限配置、接口排期", "交付人效": "人均同时服务9个项目"}, ["实施周期长", "接口排期卡点"]),
            ("data_systems", {"系统": "CRM、工单、埋点、财务分散", "健康分": "暂无统一口径", "报表": "客户成功手工维护Excel"}, ["数据口径割裂", "续费预警滞后"]),
            ("finance", {"ARR": "2600万", "NRR": "82%", "实施毛利": "约18%", "续费折扣": "最近季度平均折扣12%"}, ["续费折扣侵蚀毛利"]),
        ],
        "results": "saas",
        "feedback": ("data_systems", 4, True, "客户健康分和续费预警动作很具体，后续希望能直接接CRM数据。"),
    },
    {
        "name": f"{PREFIX} 连锁轻餐加盟扩张诊断",
        "problem_map": {
            "company_name": "一碗山城轻餐",
            "industry": "连锁餐饮",
            "main_business": "社区轻餐门店与加盟",
            "business_model": "直营样板店 + 加盟费 + 供应链差价",
            "scale": "直营6家，加盟23家，总部55人",
            "stage": "从区域品牌走向跨城扩张",
            "core_problem": "加盟咨询很多，但闭店率上升、加盟商投诉增加，总部不敢继续放量",
            "sub_problems": ["单店模型只在部分商圈成立", "供应链跨城不稳定", "加盟承诺与实际支持有落差"],
            "goal": "60天内重建加盟筛选和单店模型，暂停低质量招商",
            "constraints": "品牌声誉不能受损，供应链冷链能力有限",
            "success_criteria": "新加盟签约通过率降到可控范围，老店毛利恢复到58%以上，投诉率下降50%",
            "impact": "近半年闭店5家，投诉集中在选址、培训和原料到货",
            "context": "已有门店流水、加盟协议、招商话术和供应商数据",
            "suspected_cause": "招商放量快于总部督导和供应链能力",
            "tried": "增加督导巡店、调整首批物料政策，但加盟商满意度仍低",
            "data_readiness": "有POS流水、闭店记录、加盟合同，缺少商圈分层和督导质检数据",
            "diagnosis_focus": "channel_franchise",
            "information_score": 88,
            "missing_fields": ["商圈类型", "督导质检记录"],
            "next_question_reason": "需要先判断加盟模型是否可复制，以及合规承诺是否存在风险",
        },
        "messages": [
            ("user", "我们餐饮加盟咨询不少，但开出去的店有些活不下来，加盟商意见很大。"),
            ("assistant", "这不是单纯招商问题，而是单店模型、供应链半径、培训督导和合同承诺要一起校验。"),
            ("user", "是，我们想先把模型跑稳，再继续扩张。"),
        ],
        "answers": [
            ("channel_franchise", {"门店结构": "直营6家、加盟23家", "闭店": "近半年闭店5家", "回本周期": "招商话术称8-12个月，实际分化较大", "加盟费": "6.8万元"}, ["闭店率上升", "回本承诺风险"]),
            ("ops", {"原料到货": "跨城门店准时率约82%", "督导": "每店每月1次", "培训": "总部7天培训", "投诉": "原料、选址、出餐标准"}, ["供应链半径不足", "督导频次不足"]),
            ("finance", {"单店月流水": "成熟店18-32万，新店差异大", "毛利": "直营均值61%，加盟反馈约53%-58%", "总部收入": "加盟费和供应链差价"}, ["单店模型分化", "总部收入结构短期化"]),
            ("legal_compliance", {"招商页": "强调低门槛和快速回本", "合同": "有区域保护、物料采购约束", "资质": "食品经营相关资质由门店办理"}, ["招商宣传需降承诺", "区域保护条款需核验"]),
            ("supply_chain", {"供应商": "核心料包2家", "冷链": "第三方冷链", "损耗": "部分城市损耗偏高", "安全库存": "总部建议3天"}, ["冷链稳定性", "库存策略不清"]),
        ],
        "results": "franchise_food",
        "feedback": ("legal_compliance", 4, True, "合规提醒很有必要，招商话术需要马上重审。"),
    },
    {
        "name": f"{PREFIX} 跨境家居电商投放亏损诊断",
        "problem_map": {
            "company_name": "北岸家居",
            "industry": "跨境电商",
            "main_business": "欧美市场家居收纳用品DTC销售",
            "business_model": "Shopify独立站 + Amazon + 海外仓",
            "scale": "约65人，月销售额约180万美元",
            "stage": "从爆品驱动转向多渠道经营",
            "core_problem": "广告投放持续亏损，库存积压增加，团队不知道该砍品还是换渠道",
            "sub_problems": ["Meta广告ROAS下降", "Amazon价格竞争加剧", "海外仓库存周转变慢"],
            "goal": "45天内把亏损SKU和低效渠道分层，恢复现金流安全线",
            "constraints": "旺季库存已备，不能全部清仓打折，品牌评分不能明显下降",
            "success_criteria": "广告贡献毛利转正，库存周转天数降到90天以内，低效SKU暂停补货",
            "impact": "近两个月广告费占销售额34%，库存周转从72天升至128天",
            "context": "有广告后台截图、SKU毛利表、库存表和Amazon评论摘要",
            "suspected_cause": "渠道流量成本上升叠加SKU毛利结构恶化",
            "tried": "降低预算、换素材、做站内优惠，但毛利没有恢复",
            "data_readiness": "有广告和库存数据，缺少按SKU的贡献毛利和退货原因归因",
            "diagnosis_focus": "market",
            "information_score": 91,
            "missing_fields": ["SKU贡献毛利", "退货原因"],
            "next_question_reason": "要判断问题主因是投放、产品、库存还是定价",
        },
        "messages": [
            ("user", "跨境家居广告越投越亏，仓库里货越来越多，不知道是品不行还是渠道不行。"),
            ("assistant", "这要把广告、SKU毛利、库存周转和退货评价串起来看，单看ROAS会误判。"),
            ("user", "对，我们要知道哪些该砍，哪些还能救。"),
        ],
        "answers": [
            ("market", {"Meta ROAS": "从2.1降到1.25", "Google ROAS": "约1.55", "广告费率": "34%", "主力市场": "美国、德国、英国"}, ["投放亏损", "渠道效率下降"]),
            ("product", {"SKU": "核心SKU 42个", "差评": "安装复杂、尺寸不符、材质预期偏差", "退货率": "站点均值9.8%，部分SKU超过16%"}, ["产品体验影响转化", "退货侵蚀毛利"]),
            ("ops", {"库存周转": "128天", "海外仓": "美西、美东、德国", "滞销SKU": "14个SKU超过150天", "补货": "按销售预测人工决策"}, ["库存积压", "补货预测粗糙"]),
            ("finance", {"毛利率": "账面毛利42%，扣广告和仓储后贡献毛利为负", "现金": "可支撑约4个月", "仓储费": "环比上升28%"}, ["贡献毛利为负", "现金周转压力"]),
            ("data_systems", {"系统": "Shopify、Amazon、广告后台、仓储系统分散", "报表": "每周手工汇总", "SKU利润": "未稳定计算"}, ["SKU利润口径缺失", "数据链路断裂"]),
        ],
        "results": "crossborder",
        "feedback": ("finance", 5, True, "贡献毛利分层非常关键，应该作为老板每天看的看板。"),
    },
    {
        "name": f"{PREFIX} 装备制造招聘与交付瓶颈诊断",
        "problem_map": {
            "company_name": "恒策装备",
            "industry": "高端装备制造",
            "main_business": "非标自动化设备研发、生产与交付",
            "business_model": "项目制销售 + 定制交付 + 售后维保",
            "scale": "约210人，年营收约1.2亿",
            "stage": "订单增长但组织能力跟不上",
            "core_problem": "销售订单增加，但项目经理、机械工程师和调试人员招不到，交付延期越来越多",
            "sub_problems": ["招聘画像不清", "项目排产与人力计划脱节", "绩效激励偏向接单不偏向交付"],
            "goal": "90天内稳定关键岗位供给，把交付延期率从32%降到15%以内",
            "constraints": "不能无上限涨薪，现有项目不能大面积违约",
            "success_criteria": "关键岗位到岗8人以上，项目排产和招聘计划每周联动，延期项目有优先级机制",
            "impact": "过去季度延期项目11个，客户投诉和尾款回收受影响",
            "context": "有招聘漏斗、项目排产表、延期项目清单和薪酬区间",
            "suspected_cause": "组织能力、排产机制和招聘渠道共同失配",
            "tried": "加猎头、提高部分岗位薪资、内部推荐，但到岗质量不稳定",
            "data_readiness": "有招聘数据和项目排产，但缺少岗位胜任力和项目利润联动分析",
            "diagnosis_focus": "org",
            "information_score": 89,
            "missing_fields": ["岗位胜任力模型", "项目利润与人力投入"],
            "next_question_reason": "需要判断是人才供给问题、组织机制问题还是订单结构问题",
        },
        "messages": [
            ("user", "我们制造业订单增长，但关键岗位一直招不到，项目延期越来越严重。"),
            ("assistant", "我会把它拆成招聘漏斗、岗位画像、项目排产、绩效激励和现金回款几个联动问题来看。"),
            ("user", "对，单纯让HR多招人已经没用了。"),
        ],
        "answers": [
            ("org", {"关键岗位": "项目经理、机械工程师、电气调试", "招聘漏斗": "简历到面试18%，面试到offer22%，offer接受率54%", "离职": "试用期流失较高", "薪酬": "核心岗位低于本地高分位"}, ["关键岗位供给不足", "招聘画像不清"]),
            ("ops", {"延期率": "32%", "瓶颈": "设计评审、外协加工、现场调试", "排产": "销售接单后才倒排资源", "返工": "部分项目返工率12%"}, ["排产与人力脱节", "交付瓶颈"]),
            ("sales", {"订单": "季度新增订单同比+38%", "项目毛利": "不同项目差异大", "交付承诺": "销售为抢单承诺短交期"}, ["承诺交期偏激进", "订单质量分层不足"]),
            ("finance", {"尾款": "延期项目尾款回收延迟", "项目毛利": "低毛利定制项目拖累现金", "加班外协": "费用上升"}, ["延期影响回款", "低毛利项目占资源"]),
            ("data_systems", {"系统": "招聘、项目、工时、财务未打通", "周会": "靠人工PPT", "人力计划": "没有按项目阶段预测"}, ["数据口径割裂", "预测机制缺失"]),
        ],
        "results": "manufacturing_org",
        "feedback": ("org", 5, True, "这次不是泛泛讲招聘，而是把招聘和交付排产联动起来了。"),
    },
]


def build_results(case_key: str, skill_ids: dict[str, str]) -> tuple[list[ModuleResult], TriageSummary]:
    if case_key == "huahuo":
        results = [
            result(module="channel_franchise", signal="red", conclusion="代理模型没有被真实经营数据证明，继续放量招商会放大投诉和现金流风险", evidence=[ev("近90天38家签约代理中仅14家活跃，复购代理6家", "用户填写/代理台账"), ev("单代理首批投入8万-15万元，但缺少代理流水和回本周期", "用户填写/招商政策"), ev("招商话术涉及收益预期，需与合同承诺一致", "用户填写/宣传口径")], actions=["暂停低质量招商投放，先选2个区域代理做样板复盘", "建立代理单元模型：首批投入、月销、毛利、回本周期、售后成本", "重写招商筛选条件和培训交付清单"], skill_ids=skill_ids, source_quality=82, data_completeness=70, benchmark=74, recency=88, missing=[req("channel_cashflow", "代理真实流水与回本周期", "缺少代理经营流水，无法证明招商模型可复制", "上传代理月流水、进货、库存、售后和复购记录")], comparisons=["活跃代理占比约37%，低于可规模化招商所需的稳定活跃状态"]),
            result(module="market", signal="yellow", conclusion="市场不是完全没有需求，而是推广账号证据不足，无法判断是流量贵还是线索筛选差", evidence=[ev("线索成本从260元升至380元", "用户填写/推广复盘"), ev("有效线索率约22%，目前为销售主观判断", "用户填写/销售反馈"), ev("缺少广告后台、素材点击率和落地页转化", "数据缺口")], actions=["拉取抖音/视频号/百度等推广账号30天数据", "按线索来源建立有效线索定义，销售24小时内标注质量", "用真实客户节能账本替代泛化卖点素材"], skill_ids=skill_ids, source_quality=72, data_completeness=58, benchmark=70, recency=86, missing=[req("ad_account_export", "推广账号后台导出", "没有广告后台数据，无法判断渠道效率", "导出消耗、曝光、点击、表单、留资、转化和素材维度数据")]),
            result(module="finance", signal="red", conclusion="当前现金流承受不了继续无上限投放，必须先设招商预算红线", evidence=[ev("月固定费用约65万元，近两个月每月缺口约35万元", "用户填写/财务口径"), ev("设备毛利约34%，工程客户账期45-90天", "用户填写/财务口径"), ev("代理回款快但复购弱，难以覆盖持续投放", "综合诊断")], actions=["设定未来30天招商投放上限和止损条件", "按渠道计算现金回收周期而不是只看成交额", "把代理样板复购作为下一轮预算释放条件"], skill_ids=skill_ids, source_quality=84, data_completeness=76, benchmark=72, recency=90),
            result(module="legal_compliance", signal="yellow", conclusion="节能和收益相关宣传需要证据化，否则招商放量会增加合规与合同争议", evidence=[ev("宣传口径包含节能30%-50%", "用户填写/宣传材料"), ev("代理协议包含区域保护和培训承诺", "用户填写/合同摘要"), ev("部分检测报告已具备，但未和宣传素材逐条对应", "用户填写/资质情况")], actions=["对招商页、短视频脚本和合同承诺做逐条一致性审查", "将节能收益表达改为基于场景测算和案例证据", "高风险承诺词先下线，待检测与客户案例补齐后再恢复"], skill_ids=skill_ids, source_quality=78, data_completeness=68, benchmark=76, recency=82, missing=[req("ad_contract_review", "宣传素材与合同条款审查表", "宣传承诺和合同责任未逐条对齐", "上传招商页、直播话术、代理合同和检测报告")]),
            result(module="supply_chain", signal="yellow", conclusion="关键控制模块单一供应商和售后数据缺失，会限制代理样板复制", evidence=[ev("控制模块主供一家", "用户填写/供应链信息"), ev("常规交期15天，旺季25天", "用户填写/采购信息"), ev("售后故障反馈未系统化", "用户填写/售后信息")], actions=["为控制模块建立第二供应商或安全库存", "按代理样板记录故障率、响应时长和备件消耗", "把售后承接能力写入招商放量前置条件"], skill_ids=skill_ids, source_quality=76, data_completeness=64, benchmark=68, recency=84, missing=[req("warranty_failure", "售后故障与响应记录", "没有售后数据，无法判断代理规模化后的服务成本", "上传故障类型、响应时长、备件成本和客户满意度记录", False)]),
        ]
        tri = triage("channel_franchise", [("channel_franchise", "渠道与加盟", "核心矛盾在代理模型是否可复制"), ("finance", "财务与资本", "现金流决定投放和招商节奏"), ("legal_compliance", "法务合规", "招商承诺必须先控风险"), ("market", "市场与客户", "需要核验推广账号真实效率")], [(["market", "finance"], "市场想继续测试流量，但财务现金流要求先设预算红线"), (["channel_franchise", "legal_compliance"], "招商转化需要强承诺，但合规要求先证据化表达")], ["先完成代理样板账本，再决定是否放量投放", "合规审查通过前不要扩大招商承诺"], ["本周锁定2个代理样板", "48小时内导出推广账号数据", "两周内完成招商话术合规审查"])
        return results, tri
    if case_key == "saas":
        results = [
            result(module="product", signal="red", conclusion="续费下降的根因不是单点功能缺失，而是首月没有让客户跑通核心价值场景", evidence=[ev("首月完成核心流程配置客户约58%", "用户填写/产品埋点摘要"), ev("流失反馈集中在上线慢、价值感弱、报表不灵活", "用户填写/客户反馈"), ev("大客户续费流失4家，影响ARR约420万", "问题地图")], actions=["定义首月必达价值事件，并把实施验收改成价值事件验收", "对流失高风险客户补做关键场景激活", "把报表灵活性诉求拆成30天内可交付的小版本"], skill_ids=skill_ids, source_quality=86, data_completeness=78, benchmark=80, recency=92),
            result(module="sales", signal="yellow", conclusion="销售承诺边界过宽，正在把不适配客户推进交付漏斗", evidence=[ev("部分销售承诺深度定制和快速上线", "用户填写/销售承诺"), ev("商机赢单率18%，成交周期63天", "用户填写/CRM摘要"), ev("销售与产品对流失原因判断不一致", "问题地图")], actions=["建立销售承诺红黄线清单", "新增售前适配度评分，低适配客户需产品/交付联合审批", "复盘近4个流失大客户的承诺差异"], skill_ids=skill_ids, source_quality=78, data_completeness=70, benchmark=74, recency=90, missing=[req("promise_registry", "销售承诺清单", "缺少承诺清单时无法判断销售是否过度承诺", "导出合同、方案书、聊天纪要和售前承诺字段")]),
            result(module="ops", signal="yellow", conclusion="实施周期长由客户数据准备、权限配置和接口排期共同造成，需要前置准入", evidence=[ev("实施周期中位数47天", "用户填写/实施数据"), ev("延期原因包括客户数据整理、权限配置、接口排期", "用户填写/工单摘要"), ev("实施人均同时服务9个项目", "用户填写/团队负载")], actions=["把上线前置材料做成客户准入清单", "接口排期改为销售签约前评估", "高风险项目建立红黄灯机制"], skill_ids=skill_ids, source_quality=82, data_completeness=74, benchmark=72, recency=90),
            result(module="data_systems", signal="red", conclusion="CRM、工单、埋点和财务没有统一客户健康口径，导致续费风险发现太晚", evidence=[ev("客户成功团队靠人工Excel维护健康度", "用户填写/系统现状"), ev("CRM、工单、产品埋点、财务分散", "用户填写/系统现状"), ev("暂无统一健康分", "用户填写/数据现状")], actions=["两周内上线最小客户健康分：激活、工单、联系人、付款、使用频率", "按客户统一ID串联CRM、工单和产品埋点", "建立续费前60天风险名单和责任人"], skill_ids=skill_ids, source_quality=84, data_completeness=68, benchmark=78, recency=88, missing=[req("metric_definition", "客户健康分字段口径", "没有统一口径，客户成功无法提前预警", "定义客户ID、活跃、工单、付款、联系人和续费阶段字段")]),
            result(module="finance", signal="yellow", conclusion="续费折扣正在掩盖产品价值和实施效率问题，并侵蚀订阅质量", evidence=[ev("NRR为82%", "用户填写/财务指标"), ev("最近季度续费平均折扣12%", "用户填写/续费折扣"), ev("实施毛利约18%", "用户填写/财务指标")], actions=["折扣审批与客户健康分绑定", "区分续费挽留、扩容和低质量续约", "把实施毛利纳入项目准入复盘"], skill_ids=skill_ids, source_quality=82, data_completeness=76, benchmark=78, recency=92),
        ]
        tri = triage("product", [("product", "产品与服务", "续费本质取决于客户是否感知价值"), ("data_systems", "数据与系统", "没有健康分就无法提前管理续费"), ("ops", "运营与交付", "实施周期影响首月激活"), ("sales", "销售与增长", "承诺边界影响客户适配度")], [(["sales", "ops"], "销售想提高成交速度，但交付要求签约前完成适配评估"), (["product", "finance"], "短期折扣能保收入，但会掩盖产品价值问题")], ["首月价值事件必须成为销售、产品、交付共同指标", "客户健康分先做最小版本，不等系统大改"], ["定义首月价值事件", "建立销售承诺红黄线", "上线续费风险名单"])
        return results, tri
    if case_key == "franchise_food":
        results = [
            result(module="channel_franchise", signal="red", conclusion="加盟扩张已经超过单店模型和总部赋能能力，继续放量会伤害品牌", evidence=[ev("直营6家、加盟23家，近半年闭店5家", "用户填写/门店数据"), ev("招商口径称8-12个月回本，但实际分化较大", "用户填写/招商话术"), ev("投诉集中在选址、培训和原料到货", "用户填写/投诉摘要")], actions=["暂停低质量招商，按商圈类型重建单店模型", "把加盟商筛选从资金门槛升级为经营能力评分", "闭店案例逐一复盘，形成禁入商圈和禁入人群"], skill_ids=skill_ids, source_quality=84, data_completeness=72, benchmark=80, recency=90, missing=[req("store_unit_model", "分商圈单店模型", "没有商圈分层时，平均单店数据会误导扩张", "上传门店流水、租金、人力、外卖占比、商圈类型和闭店原因")]),
            result(module="ops", signal="red", conclusion="跨城供应链和督导频次不足，是加盟商体验恶化的直接原因", evidence=[ev("跨城门店原料到货准时率约82%", "用户填写/供应链数据"), ev("督导频次为每店每月1次", "用户填写/运营机制"), ev("投诉包括原料、选址、出餐标准", "用户填写/投诉摘要")], actions=["将扩张城市按冷链能力分级，不达标城市暂停招商", "高风险新店前30天督导频次提升到每周1次", "建立门店开业前检查和出餐标准抽检"], skill_ids=skill_ids, source_quality=82, data_completeness=70, benchmark=76, recency=90),
            result(module="finance", signal="yellow", conclusion="总部短期收入依赖加盟费，会与长期门店存活率形成冲突", evidence=[ev("总部收入来自加盟费和供应链差价", "用户填写/收入结构"), ev("直营毛利均值61%，加盟反馈约53%-58%", "用户填写/财务数据"), ev("新店表现差异大", "用户填写/门店流水")], actions=["将招商奖金与门店90天存活和毛利挂钩", "把加盟费收入和供应链长期毛利分开看", "建立低毛利门店帮扶或退出机制"], skill_ids=skill_ids, source_quality=80, data_completeness=68, benchmark=76, recency=88),
            result(module="legal_compliance", signal="yellow", conclusion="快速回本、低门槛等招商表达需要降温，避免加盟争议", evidence=[ev("招商页强调低门槛和快速回本", "用户填写/招商素材"), ev("合同包含区域保护和物料采购约束", "用户填写/合同摘要"), ev("食品经营资质由门店办理", "用户填写/资质情况")], actions=["下线绝对化或确定收益表达", "重审区域保护、采购约束和培训责任条款", "给加盟商确认风险告知书和开店成本清单"], skill_ids=skill_ids, source_quality=78, data_completeness=66, benchmark=78, recency=84, missing=[req("franchise_contract", "加盟合同与招商素材", "需核验招商承诺与合同义务是否一致", "上传招商页、销售话术、加盟合同和风险告知书")]),
            result(module="supply_chain", signal="yellow", conclusion="冷链和核心料包供应尚不能支撑跨城快速复制", evidence=[ev("核心料包供应商2家", "用户填写/供应商信息"), ev("部分城市损耗偏高", "用户填写/冷链反馈"), ev("总部建议安全库存3天", "用户填写/库存策略")], actions=["按城市建立到货准时率和损耗看板", "核心料包建立备选供应商和最低服务标准", "库存策略按城市距离和销量分层"], skill_ids=skill_ids, source_quality=76, data_completeness=64, benchmark=72, recency=86),
        ]
        tri = triage("channel_franchise", [("channel_franchise", "渠道与加盟", "闭店和投诉说明扩张模型先要刹车"), ("ops", "运营与交付", "供应链和督导决定加盟体验"), ("legal_compliance", "法务合规", "招商承诺需控风险"), ("finance", "财务与资本", "收入结构要从短期加盟费转向长期门店存活")], [(["sales", "legal_compliance"], "招商转化依赖强承诺，但合规要求降低确定收益表达"), (["finance", "channel_franchise"], "短期加盟费收入与长期闭店风险冲突")], ["扩张节奏由单店模型和供应链半径共同决定", "招商激励必须绑定门店存活"], ["暂停低质量招商", "重建分商圈单店模型", "重审招商素材和合同"])
        return results, tri
    if case_key == "crossborder":
        results = [
            result(module="market", signal="red", conclusion="广告亏损不能继续按渠道平均ROAS判断，必须按SKU贡献毛利分层止损", evidence=[ev("Meta ROAS从2.1降到1.25，广告费率34%", "用户填写/广告后台摘要"), ev("Google ROAS约1.55", "用户填写/广告后台摘要"), ev("缺少按SKU贡献毛利", "数据缺口")], actions=["按SKU建立广告贡献毛利表，低于红线立即降预算", "拆分新品测试、利润SKU和清库存SKU三类预算", "素材测试只保留能提升贡献毛利的组合"], skill_ids=skill_ids, source_quality=86, data_completeness=74, benchmark=80, recency=92, missing=[req("sku_contribution_margin", "SKU贡献毛利表", "没有SKU贡献毛利会导致ROAS判断失真", "导出SKU销售额、广告费、平台费、物流仓储、退货和毛利")]),
            result(module="product", signal="yellow", conclusion="部分SKU的退货和差评正在吞噬投放效率，需要先修体验再加预算", evidence=[ev("部分SKU退货率超过16%", "用户填写/退货数据"), ev("差评集中在安装复杂、尺寸不符、材质预期偏差", "用户填写/评论摘要"), ev("核心SKU共42个", "用户填写/SKU信息")], actions=["对高退货SKU暂停扩量，先修详情页尺寸和安装说明", "将差评原因映射到产品改版和客服话术", "保留评分稳定且贡献毛利为正的SKU"], skill_ids=skill_ids, source_quality=80, data_completeness=70, benchmark=78, recency=90, missing=[req("return_reason", "退货原因归因", "退货原因不清会误判产品和投放问题", "上传退货原因、客服记录、差评标签和SKU版本")]),
            result(module="ops", signal="red", conclusion="库存周转已经成为现金流风险，补货决策必须从销量预测改为贡献毛利和周转双约束", evidence=[ev("库存周转从72天升至128天", "问题地图/库存表"), ev("14个SKU超过150天", "用户填写/库存数据"), ev("美西、美东、德国海外仓分散", "用户填写/仓储信息")], actions=["建立滞销SKU清理优先级：库龄、毛利、广告效率、评分", "暂停低贡献SKU补货", "按仓库和SKU设置周转红线"], skill_ids=skill_ids, source_quality=84, data_completeness=76, benchmark=80, recency=92),
            result(module="finance", signal="red", conclusion="账面毛利不能反映真实经营，扣除广告和仓储后贡献毛利已为负", evidence=[ev("账面毛利42%，扣广告和仓储后贡献毛利为负", "用户填写/财务数据"), ev("现金可支撑约4个月", "用户填写/现金情况"), ev("仓储费环比上升28%", "用户填写/仓储费用")], actions=["老板会每日只看贡献毛利、现金周转和库存库龄", "设定SKU止损线和清仓授权机制", "将广告预算释放与现金回收挂钩"], skill_ids=skill_ids, source_quality=86, data_completeness=78, benchmark=80, recency=92),
            result(module="data_systems", signal="yellow", conclusion="Shopify、Amazon、广告和仓储系统未串联，导致团队只能事后解释亏损", evidence=[ev("每周手工汇总报表", "用户填写/系统现状"), ev("SKU利润未稳定计算", "用户填写/系统现状"), ev("广告后台、仓储系统和平台数据分散", "用户填写/系统现状")], actions=["先做最小SKU经营看板", "统一SKU ID和币种汇率口径", "每周复盘从渠道ROAS改为SKU贡献毛利"], skill_ids=skill_ids, source_quality=78, data_completeness=66, benchmark=76, recency=88),
        ]
        tri = triage("market", [("market", "市场与客户", "投放亏损是当前现金消耗入口"), ("finance", "财务与资本", "贡献毛利决定是否继续投放"), ("ops", "运营与供应链", "库存周转决定现金安全"), ("product", "产品与服务", "退货和差评影响广告效率")], [(["market", "finance"], "市场想保规模测试，但财务要求贡献毛利为正"), (["ops", "product"], "库存清理可能伤害评分，需要产品和客服配合")], ["广告预算按SKU贡献毛利释放", "库存清理和产品体验修复同步推进"], ["建立SKU贡献毛利表", "暂停低效SKU补货", "设置广告止损线"])
        return results, tri
    results = [
        result(module="org", signal="red", conclusion="招聘问题的根因不是HR动作不够，而是岗位画像、项目排产和激励机制没有联动", evidence=[ev("简历到面试18%，面试到offer22%，offer接受率54%", "用户填写/招聘漏斗"), ev("项目经理、机械工程师、电气调试为关键缺口", "问题地图"), ev("试用期流失较高", "用户填写/组织数据")], actions=["把关键岗位画像从学历经验改为项目阶段能力模型", "招聘计划每周与项目排产联动", "核心岗位薪酬不盲目普涨，先对稀缺能力设专项包"], skill_ids=skill_ids, source_quality=84, data_completeness=74, benchmark=78, recency=90, missing=[req("competency_model", "关键岗位胜任力模型", "缺少胜任力模型会导致招聘筛选和试用期评价失真", "补充优秀项目经理、机械工程师、调试人员的能力画像和失败样本")]),
        result(module="ops", signal="red", conclusion="交付延期已经从项目管理问题升级为经营资源分配问题", evidence=[ev("过去季度延期项目11个，延期率32%", "问题地图/项目清单"), ev("瓶颈在设计评审、外协加工、现场调试", "用户填写/排产数据"), ev("销售接单后才倒排资源", "用户填写/流程现状")], actions=["建立订单准入和资源评审机制", "将延期项目按客户影响、尾款、毛利分级", "每周用项目阶段负荷表驱动招聘和外协计划"], skill_ids=skill_ids, source_quality=86, data_completeness=78, benchmark=80, recency=92),
        result(module="sales", signal="yellow", conclusion="销售为抢单承诺短交期，正在把组织瓶颈前移到交付端", evidence=[ev("季度新增订单同比+38%", "用户填写/销售数据"), ev("销售为抢单承诺短交期", "用户填写/销售反馈"), ev("不同项目毛利差异大", "用户填写/订单结构")], actions=["销售报价前必须完成交期和资源评审", "低毛利高定制订单进入老板审批", "销售激励增加尾款回收和准时交付权重"], skill_ids=skill_ids, source_quality=78, data_completeness=70, benchmark=76, recency=90),
        result(module="finance", signal="yellow", conclusion="延期项目正在拖慢尾款回收，低毛利定制订单会继续消耗稀缺工程资源", evidence=[ev("延期项目尾款回收延迟", "用户填写/财务数据"), ev("低毛利定制项目拖累现金", "用户填写/项目毛利"), ev("加班外协费用上升", "用户填写/成本数据")], actions=["按项目毛利和回款风险排序资源", "建立延期项目现金影响看板", "外协预算与关键岗位招聘联动"], skill_ids=skill_ids, source_quality=80, data_completeness=70, benchmark=76, recency=88, missing=[req("project_margin", "项目毛利与人力投入", "缺少项目毛利和人力投入，无法判断哪些订单消耗资源", "上传项目报价、预算工时、实际工时、外协费用和尾款状态")]),
        result(module="data_systems", signal="yellow", conclusion="招聘、项目、工时和财务数据未打通，导致管理层只能看到延期结果，看不到提前预警", evidence=[ev("招聘、项目、工时、财务未打通", "用户填写/系统现状"), ev("周会靠人工PPT", "用户填写/管理机制"), ev("没有按项目阶段预测人力计划", "用户填写/计划方式")], actions=["建立项目阶段-岗位负荷最小看板", "统一项目ID，串联招聘、工时、外协和回款", "把未来8周资源缺口作为经营会固定议题"], skill_ids=skill_ids, source_quality=78, data_completeness=66, benchmark=76, recency=88),
    ]
    tri = triage("org", [("org", "组织与人才", "关键岗位供给是最直接瓶颈"), ("ops", "运营与交付", "交付延期暴露资源排产失控"), ("sales", "销售与增长", "订单承诺影响交付压力"), ("finance", "财务与资本", "尾款和低毛利订单决定优先级")], [(["sales", "ops"], "销售追求接单速度，但交付需要资源评审"), (["org", "finance"], "组织需要抢人，但财务不能无上限涨薪")], ["招聘计划必须跟项目排产绑定", "订单准入要进入老板会拍板"], ["重建关键岗位画像", "建立8周资源负荷表", "对低毛利短交期订单设审批"])
    return results, tri


async def skill_ids_for(session) -> dict[str, str]:
    rows = await session.scalars(select(SkillVersion).where(SkillVersion.is_active == True))  # noqa: E712
    return {row.module: row.id for row in rows}


async def add_memory(session, project: Project, user_id: str, entry_type: str, summary: str, payload: dict, source_id: str | None) -> None:
    entry = ProjectMemoryEntry(
        project_id=project.id,
        user_id=user_id,
        entry_type=entry_type,
        summary=sentence(summary),
        payload_json=json.dumps(payload, ensure_ascii=False, default=str),
        source_id=source_id,
    )
    session.add(entry)
    lines = [line for line in project.memory_summary.split("\n") if line.strip()]
    label = {"problem_map": "问题地图", "diagnosis": "诊断", "feedback": "反馈", "test_step": "测试步骤"}.get(entry_type, entry_type)
    lines.append(f"[{now().strftime('%Y-%m-%d')}] {label}：{sentence(summary)}")
    project.memory_summary = "\n".join(lines[-10:])
    project.updated_at = now()
    session.add(project)


async def seed() -> None:
    await init_db()
    async with AsyncSessionLocal() as session:
        user = await session.scalar(select(User).where(User.email == TARGET_EMAIL))
        if user is None:
            raise RuntimeError(f"Cannot find target account: {TARGET_EMAIL}")
        skill_ids = await skill_ids_for(session)
        created: list[tuple[str, str, str, str]] = []

        for case in CASES:
            pm = case["problem_map"]
            project = Project(
                user_id=user.id,
                name=case["name"],
                profile_json=json.dumps(pm, ensure_ascii=False),
                memory_summary="",
                status="active",
            )
            session.add(project)
            await session.flush()

            messages = [{"role": role, "content": sentence(content)} for role, content in case["messages"]]
            chat_session = DiagnosisSession(
                user_id=user.id,
                project_id=project.id,
                messages_json=json.dumps(messages, ensure_ascii=False),
                problem_map_json=json.dumps(pm, ensure_ascii=False),
                title=pm["core_problem"][:60],
                status="confirmed",
            )
            session.add(chat_session)
            await session.flush()

            answers = [ModuleAnswer(module=m, facts=facts, pains=pains, context={"测试场景": case["name"]}) for m, facts, pains in case["answers"]]
            questionnaire = Questionnaire(answers=answers, session_id=chat_session.id, project_id=project.id, problem_map=pm)
            results, tri = build_results(case["results"], skill_ids)
            plan: WarRoomPlan = compose_war_room_plan(questionnaire, results, tri, skill_ids)

            record = DiagnosisRecord(
                user_id=user.id,
                answers_json=questionnaire.model_dump_json(),
                results_json=json.dumps([item.model_dump() for item in results], ensure_ascii=False),
                profile_json=json.dumps(pm, ensure_ascii=False),
                session_id=chat_session.id,
                project_id=project.id,
            )
            session.add(record)
            await session.flush()
            plan.record_id = record.id
            plan.project_id = project.id
            plan.source_record_ids = [record.id]
            plan.iteration_count = 1
            record.war_room_plan_json = plan.model_dump_json()
            chat_session.diagnosis_record_id = record.id
            chat_session.status = "diagnosed"
            session.add(record)
            session.add(chat_session)
            await session.flush()
            project_plan = await apply_project_war_room_iteration(session, project.id, record, plan)
            if project_plan is not None:
                project.war_room_plan_json = project_plan.model_dump_json()

            await add_memory(session, project, user.id, "problem_map", f"核心问题：{pm['core_problem']}；目标：{pm['goal']}", pm, chat_session.id)
            await add_memory(
                session,
                project,
                user.id,
                "diagnosis",
                f"主战场：{tri.primary_module}；最高优先动作：{tri.priority_actions[0] if tri.priority_actions else results[0].actions[0]}",
                {"triage": tri.model_dump(), "results": [item.model_dump() for item in results]},
                record.id,
            )
            await add_memory(
                session,
                project,
                user.id,
                "test_step",
                "测试链路已覆盖新建项目、对话问题地图、问卷答案、专家会诊、证据包、作战室、长期记忆和反馈沉淀",
                {
                    "steps": [
                        "新建项目",
                        "写入对话消息和问题地图",
                        "写入多模块问卷答案",
                        "生成专家结果和证据置信度",
                        "生成项目级作战室",
                        "写入长期记忆时间线",
                        "提交一条用户反馈",
                    ]
                },
                record.id,
            )

            module, rating, useful, comment = case["feedback"]
            feedback = DiagnosisFeedback(
                record_id=record.id,
                module=module,
                skill_version_id=skill_ids.get(module, f"seed-{module}"),
                user_id=user.id,
                rating=rating,
                is_useful=useful,
                comment=sentence(comment),
            )
            session.add(feedback)
            await session.flush()
            await add_memory(
                session,
                project,
                user.id,
                "feedback",
                f"{module} 诊断反馈：{'有帮助' if useful else '待改进'}，评分 {rating}/5；反馈：{comment}",
                {
                    "record_id": record.id,
                    "module": module,
                    "skill_version_id": feedback.skill_version_id,
                    "rating": rating,
                    "is_useful": useful,
                    "comment": sentence(comment),
                },
                feedback.id,
            )

            project.updated_at = now()
            session.add(project)
            created.append((project.id, project.name, chat_session.id, record.id))

        await session.commit()

    print("Seeded consulting cases:")
    for project_id, name, session_id, record_id in created:
        print(f"- {name}\n  project_id={project_id}\n  session_id={session_id}\n  record_id={record_id}")


if __name__ == "__main__":
    asyncio.run(seed())
