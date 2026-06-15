"""演示案例生成器 —— 用真实系统组件生成两个完整诊断案例，写入指定账号。

走真实链路：路由召回 → 证据包/置信度 → 作战室骨架(composer) → L3 脱敏归档。
唯一手写的是"专家结论的自然语言"(本应 LLM 生成)——通过 ScriptedLLM 注入，
保证每个结构字段都是系统真实产出，可上台逐字段展示。

用法：cd backend && .venv/bin/python -m scripts.seed_demo_cases
"""
from __future__ import annotations

import asyncio
import json

from app.cases.archiver import archive_case
from app.db.database import AsyncSessionLocal, init_db
from app.db.models import DiagnosisRecord, User
from app.models.questionnaire import ModuleAnswer, Questionnaire
from app.orchestrator.dispatcher import diagnose_all
from app.warroom.composer import compose_war_room_plan
from sqlalchemy import select

DEMO_EMAIL = "msnirvana@hotmail.com"


class ScriptedLLM:
    """按 module 返回预先写好的专家结论（结构走真实 skill，文字由顾问水准手写）。

    skill 的 prompt 里 module 字段会出现在传入 prompt 中，据此分流。
    找不到匹配则返回一个合规的"缺数据降级"输出。
    """

    def __init__(self, scripts: dict[str, dict]):
        self._scripts = scripts

    async def complete(self, system: str, prompt: str) -> str:
        try:
            payload = json.loads(prompt)
            module = payload.get("module", "")
        except Exception:  # noqa: BLE001
            module = ""
        data = self._scripts.get(module) or {
            "signal": "yellow",
            "conclusion": "当前缺少关键经营数据，暂无法形成可靠判断，建议先补齐数据再诊断。",
            "evidence": [],
            "actions": ["补齐关键经营数据后重新诊断"],
            "drilldown": {"data_points": [], "comparisons": []},
        }
        return json.dumps(data, ensure_ascii=False)


async def _get_demo_user(session) -> User:
    user = await session.scalar(select(User).where(User.email == DEMO_EMAIL))
    if user is None:
        raise SystemExit(f"账号 {DEMO_EMAIL} 不存在，请先确认主账号邮箱")
    return user


# 副专家的"缺数据申报"——每个专家按自己的身份诚实说还差什么，而不是千篇一律的套话。
# 这是方案A(多专家会诊)的卖点：每个专家都真看了问题，只是诚实地说要补哪些数据。
DEFER_SCRIPTS: dict[str, dict] = {
    "market": {
        "signal": "yellow",
        "conclusion": "作为市场专家，我需要先看到投放渠道结构和客群画像才能判断是不是市场定位问题，当前数据不足以下结论。",
        "evidence": [],
        "actions": ["补充主投平台分布、自然/付费流量占比", "提供目标客群与竞品价格带"],
        "drilldown": {"data_points": [], "comparisons": []},
    },
    "sales": {
        "signal": "yellow",
        "conclusion": "作为销售专家，我看不到成交漏斗和跟进数据，无法判断转化在哪一环流失，建议补齐后再下结论。",
        "evidence": [],
        "actions": ["上传线索到成交的分阶段转化数据", "补充销售跟进记录与丢单原因"],
        "drilldown": {"data_points": [], "comparisons": []},
    },
    "channel_franchise": {
        "signal": "yellow",
        "conclusion": "作为渠道专家，我需要单店/单渠道模型和渠道政策才能判断扩张是否可复制，当前仅有门店数不够。",
        "evidence": [],
        "actions": ["上传样板店单店模型(营收/毛利/回本)", "补充区域保护与督导政策"],
        "drilldown": {"data_points": [], "comparisons": []},
    },
}


# ============ 案例一：DTC美妆电商 · 投放效率（数据齐全 → 红灯强结论）============
CASE_1_QUESTIONNAIRE = Questionnaire(
    answers=[
        ModuleAnswer(
            module="dtc_ads",
            facts={
                "ROAS": "1.2", "毛利率": "35%", "CAC": "180元",
                "客单价": "210元", "复购率": "12%", "月广告花费": "85万元",
            },
            pains=["投放越来越贵", "感觉在给平台打工", "不敢停投又不赚钱"],
        ),
    ],
    problem_map={
        "company_name": "某新锐彩妆品牌",
        "industry": "DTC美妆电商",
        "main_business": "线上彩妆品牌，主投千川+小红书",
        "scale": "年营收约3000万元",
        "core_problem": "广告越投越贵，ROAS掉到1.2，月广告花费85万元但不赚钱",
        "goal": "30天内把投放效率拉回健康线，先止血再谈增长",
        "diagnosis_focus": "dtc_ads",
    },
)

CASE_1_SCRIPTS = {
    "dtc_ads": {
        "signal": "red",
        "conclusion": "ROAS仅1.2、毛利率35%，投放已在亏现金——问题不在出价而在复购率12%撑不起180元的获客成本。",
        "evidence": [
            {"text": "ROAS 1.2 × 毛利率 35% = 毛利回收0.42，每投1元亏0.58元毛利", "source": "你提供的投放与客单数据"},
            {"text": "CAC 180元 vs 客单价210元，首单毛利仅73元，首单即亏107元", "source": "你提供的经营数据"},
            {"text": "复购率12%偏低，无法靠复购摊薄获客成本（健康DTC通常>25%）", "source": "行业基准对照"},
        ],
        "actions": [
            "暂停ROAS低于1.5的计划，先止血止住每天的亏损",
            "把预算重分到复购人群再营销，先救能算过账的盘子",
            "核验客单价210元能否提到260元以上，否则这个单店模型不成立",
        ],
        "drilldown": {
            "data_points": [
                {"text": "毛利回收率 0.42（ROAS1.2×毛利35%）", "source": "测算"},
                {"text": "首单亏损 107元/单", "source": "测算"},
            ],
            "comparisons": ["复购率12% vs 行业健康线25%", "ROAS1.2 vs 盈亏平衡线2.86(=1/0.35)"],
        },
    },
}


# ============ 案例二：连锁餐饮 · 加盟招商（部分缺数据 → 展示缺数据申报）============
CASE_2_QUESTIONNAIRE = Questionnaire(
    answers=[
        ModuleAnswer(
            module="fb_franchise",
            facts={
                "开业门店数": "120", "闭店数": "47",
                "加盟商存活率": "61%", "招商转化率": "25%",
            },
            pains=["招商签得挺快但加盟商不断关店", "口碑越来越差"],
        ),
    ],
    problem_map={
        "company_name": "某区域小吃连锁",
        "industry": "连锁餐饮",
        "main_business": "区域性小吃快餐连锁，主打加盟扩张",
        "scale": "门店约120家",
        "core_problem": "招商转化率25%看着不错，但闭店47家、存活率只剩61%",
        "goal": "搞清楚是招商模式问题还是单店模型问题",
        "diagnosis_focus": "fb_franchise",
    },
)

CASE_2_SCRIPTS = {
    "fb_franchise": {
        "signal": "red",
        "conclusion": "招商转化率25%配存活率61%，是典型的高签约低存活——在收割加盟商而非做品牌，闭店47家已是危险信号。",
        "evidence": [
            {"text": "加盟商存活率61%，低于行业健康线75-85%，每3家就有1家活不过首年", "source": "你提供的门店数据对照行业基准"},
            {"text": "开业120家、闭店47家，净增仅73家，闭店率39%", "source": "你提供的门店数据"},
            {"text": "招商转化率25%偏高但与低存活并存，说明签约话术强于单店赚钱能力", "source": "经营信号研判"},
        ],
        "actions": [
            "暂停激进招商，先核验单店模型到底赚不赚钱（缺这个数据无法下最终结论）",
            "收紧加盟商筛选，宁可慢也不要再签注定关店的店",
            "回收闭店原因做复盘清单，定位是选址、产品还是总部督导缺位",
        ],
        "drilldown": {
            "data_points": [
                {"text": "净增门店73家（120-47）", "source": "测算"},
                {"text": "闭店率39%（47/120）", "source": "测算"},
            ],
            "comparisons": ["存活率61% vs 行业健康线75-85%"],
        },
    },
}


async def _run_one_case(session, user, questionnaire, scripts, title):
    """跑一个案例：真实路由+诊断+作战室骨架，写 DiagnosisRecord + L3 归档。"""
    # 主 skill 用手写专家结论，其余被会诊召回的副 skill 用各自专业的缺数据申报。
    merged = {**DEFER_SCRIPTS, **scripts}
    llm = ScriptedLLM(merged)
    outcome = await diagnose_all(questionnaire, llm, session)
    war_room_plan = compose_war_room_plan(
        questionnaire, outcome.results, outcome.triage, outcome.skill_version_ids,
    )
    record = DiagnosisRecord(
        user_id=user.id,
        answers_json=questionnaire.model_dump_json(),
        results_json=json.dumps([r.model_dump() for r in outcome.results], ensure_ascii=False),
        profile_json=json.dumps(questionnaire.problem_map, ensure_ascii=False),
    )
    war_room_plan.record_id = record.id
    record.war_room_plan_json = war_room_plan.model_dump_json()
    session.add(record)
    await session.commit()
    case = await archive_case(session, questionnaire, outcome.results, outcome.triage, record.id)

    print(f"\n{'='*60}\n【{title}】record={record.id[:8]}")
    for r in outcome.results:
        conf = r.evidence_package.confidence if r.evidence_package else None
        print(f"  召回 skill: {r.module} | 信号: {r.signal} | 置信度: {conf}")
        print(f"  结论: {r.conclusion}")
        if r.data_requests:
            print(f"  缺数据申报: {[dr.key for dr in r.data_requests]}")
    print(f"  主战场: {war_room_plan.primary_battlefield} | 部门动作卡: {len(war_room_plan.department_actions)} 张")
    print(f"  老板拍板项: {len(war_room_plan.decision_items)} 条 | 复盘节点: {len(war_room_plan.checkpoints)} 个")
    print(f"  L3 已脱敏归档: {'✓ case=' + case.id[:8] if case else '✗ 失败'}")
    return record, war_room_plan, case


async def _cleanup_prior_demos(session, user) -> None:
    """删掉上一轮种的演示记录（按演示企业名匹配），保证可重复跑不堆垃圾。"""
    from app.db.models import CaseAsset
    from sqlalchemy import delete

    recs = (await session.scalars(
        select(DiagnosisRecord).where(DiagnosisRecord.user_id == user.id)
    )).all()
    markers = ("某新锐彩妆品牌", "某区域小吃连锁")
    removed_record_ids = []
    for r in recs:
        if r.profile_json and any(m in r.profile_json for m in markers):
            removed_record_ids.append(r.id)
            await session.delete(r)
    if removed_record_ids:
        await session.execute(
            delete(CaseAsset).where(CaseAsset.source_record_id.in_(removed_record_ids))
        )
    await session.commit()
    if removed_record_ids:
        print(f"清理上一轮演示记录: {len(removed_record_ids)} 条")


async def main() -> None:
    await init_db()
    async with AsyncSessionLocal() as session:
        user = await _get_demo_user(session)
        print(f"目标账号: {DEMO_EMAIL} ({user.id[:8]})")
        await _cleanup_prior_demos(session, user)
        await _run_one_case(session, user, CASE_1_QUESTIONNAIRE, CASE_1_SCRIPTS, "案例一 · DTC美妆电商·投放效率诊断")
        await _run_one_case(session, user, CASE_2_QUESTIONNAIRE, CASE_2_SCRIPTS, "案例二 · 连锁餐饮·加盟招商诊断")
        print(f"\n{'='*60}\n两个案例已写入账号 {DEMO_EMAIL}，登录后在「诊断历史」可见。")


if __name__ == "__main__":
    asyncio.run(main())
