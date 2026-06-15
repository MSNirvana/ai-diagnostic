"""Skill 验收断言库 —— Loop 1 生产线的机器质检闸门。

对应 docs/eval/skill_acceptance_v1.md 的 L1（结构合规）+ L2（内容质量机器部分）。
每条断言输入 (ModuleResult, EvalContext)，返回 AssertionResult。

设计原则（反 Goodhart）：每条断言都假设"AI 会试图用看似满足实则无用的方式骗过它"，
所以断言要检查实质而非表面。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.models.questionnaire import ModuleAnswer
from app.models.result import ModuleResult


# ---- 模板腔禁用词库（C4）：在 conclusion 里出现即扣分 ----
# 这些是 composer.py 旧硬编码和常见 LLM 套话，出现说明在套模板而非真分析
TEMPLATE_PHRASES: tuple[str, ...] = (
    "未来30天优先打",
    "未来 30 天优先打",
    "把核心问题转成动作",
    "建议关注",
    "需要引起重视",
    "总的来说",
    "综上所述",
    "具有重要意义",
    "为企业赋能",
    "助力企业",
    "进一步提升",
    "不断优化",
    "持续改进",
)

# ---- 废话行动词库（C3 反向）：action 只有这些没有真动词即扣分 ----
EMPTY_ACTION_PHRASES: tuple[str, ...] = (
    "加强", "强化", "提升", "优化", "改善", "改进",
    "重视", "关注", "推进", "深化", "完善", "做好",
    "梳理", "统筹", "协同", "赋能",
)

# ---- 强动作动词库（C3）：无歧义、多字优先。含其一即视为可执行 ----
# 不用单字"加/改"等，因为会误匹配"加强/改善"这类废话词
ACTION_VERBS: tuple[str, ...] = (
    "暂停", "暂缓", "缓推", "停掉", "关停", "砍掉", "下线", "下架", "叫停",
    "改写", "重写", "重做", "重谈", "重算", "重分", "重排",
    "新增", "增设", "上线", "搭建", "建立", "设立",
    "切换", "迁移", "拆分", "合并", "拉通", "拉清单", "拉台账",
    "下调", "上调", "压降", "压向", "压缩", "削减", "提价", "降价", "收紧", "收窄",
    "设上限", "卡住", "限制", "封顶", "设红线",
    "核验", "核查", "盘点", "排查", "回收", "补齐", "补充",
    "驻店", "督导", "抢救", "止血", "测算", "复核",
    "调取", "拉成", "拉出", "拉取", "调阅", "梳成", "做成", "拆到", "拆解", "拆出",
    "试点", "灰度", "复盘", "首响",
)

# ---- 负面判断词（C8）：signal=red 时 conclusion 应含其一 ----
NEGATIVE_WORDS: tuple[str, ...] = (
    "流失", "下滑", "亏", "过高", "偏高", "偏低", "不足", "缺", "差",
    "风险", "瓶颈", "失衡", "断", "卡", "低于", "高于", "恶化", "下降",
    "失效", "无效", "错", "问题", "隐患", "超支", "积压",
    "不成立", "超红线", "超…线", "已超", "不可持续", "红灯", "止血",
    "亏损", "收割", "倒挂", "硬伤", "拖累", "反噬", "难以为继", "踩线",
)

# ---- 占位/无效来源（S5）：source 是这些即视为缺失 ----
INVALID_SOURCES: tuple[str, ...] = (
    "未注明", "无", "n/a", "na", "待补充", "tbd", "todo",
    "行业报告", "相关数据", "内部数据", "（无内容）",
)

_NUMBER_RE = re.compile(r"\d")
# 抽取文本中的数字 token（含百分比、千分位、小数），用于 C2 数字溯源
_NUMBER_TOKEN_RE = re.compile(r"\d[\d,\.]*%?")


@dataclass
class EvalContext:
    """判断一条结果是否合格所需的上下文。"""
    answer: ModuleAnswer                          # 该次诊断的输入
    industry_kpis: tuple[str, ...] = ()           # 该行业核心 KPI 词（C6）
    benchmark_numbers: tuple[str, ...] = ()        # benchmark 提供的数字（C2 允许来源）
    requirements: tuple = ()                       # tuple[DataRequirement]：S8 用 keywords 独立核验缺数据申报
    anchor_text: str = ""                          # skill prompt 正文：内含行业基准锚点数字（如"24个月红线"），C2 视为合法来源


@dataclass
class AssertionResult:
    code: str
    level: str          # "L1" | "L2"
    passed: bool
    detail: str = ""


@dataclass
class EvalReport:
    results: list[AssertionResult] = field(default_factory=list)

    @property
    def l1_passed(self) -> bool:
        return all(r.passed for r in self.results if r.level == "L1")

    @property
    def l2_pass_rate(self) -> float:
        l2 = [r for r in self.results if r.level == "L2"]
        if not l2:
            return 1.0
        return sum(1 for r in l2 if r.passed) / len(l2)

    @property
    def failures(self) -> list[AssertionResult]:
        return [r for r in self.results if not r.passed]


# ============ L1 结构合规（硬否决） ============

def _l1_checks(r: ModuleResult, ctx: EvalContext) -> list[AssertionResult]:
    out: list[AssertionResult] = []

    # S1: 能被 ModuleResult 反序列化 —— 能进这个函数说明已是 ModuleResult 实例
    out.append(AssertionResult("S1", "L1", True, "已是合法 ModuleResult"))

    # S2: signal 合法
    out.append(AssertionResult(
        "S2", "L1", r.signal in ("red", "yellow", "green"), f"signal={r.signal}"
    ))

    # S3: evidence ≤ 3
    out.append(AssertionResult(
        "S3", "L1", len(r.evidence) <= 3, f"evidence 条数={len(r.evidence)}"
    ))

    # S4: 1 ≤ actions ≤ 5
    out.append(AssertionResult(
        "S4", "L1", 1 <= len(r.actions) <= 5, f"actions 条数={len(r.actions)}"
    ))

    # S5: 每条 evidence 的 text/source 非空非占位
    bad = [
        e.text for e in r.evidence
        if not e.text.strip()
        or not e.source.strip()
        or e.source.strip().lower() in INVALID_SOURCES
    ]
    out.append(AssertionResult(
        "S5", "L1", not bad, "存在占位/缺失来源的证据：" + "；".join(bad[:2]) if bad else "证据来源齐全"
    ))

    # S6: conclusion ≥ 10 字
    out.append(AssertionResult(
        "S6", "L1", len(r.conclusion.strip()) >= 10, f"conclusion 长度={len(r.conclusion.strip())}"
    ))

    # S7: confidence ∈[0,1] 且 reason 非空
    ep = r.evidence_package
    s7 = ep is not None and 0 <= ep.confidence <= 1 and bool(ep.confidence_reason.strip())
    out.append(AssertionResult("S7", "L1", s7, "证据包置信度/理由完整" if s7 else "证据包缺失或置信度非法"))

    # S8: 声明的 required 数据缺失时，必须出现在 data_requests
    # 用和 skill 相同的 keyword 匹配逻辑独立判断"哪些 required 数据真缺"，
    # 再核验这些是否都申报了。避免用裸 key 字符串误判（key 不会出现在用户输入里）。
    requested_keys = {dr.key for dr in r.data_requests}
    facts_haystack = " ".join(
        f"{k}{v}" for k, v in ctx.answer.facts.items() if str(v).strip()
    )
    facts_haystack += " " + " ".join(ctx.answer.uploaded_files)
    missing_undeclared = []
    for req in ctx.requirements:
        if not getattr(req, "required", True):
            continue
        satisfied = any(kw in facts_haystack for kw in getattr(req, "keywords", ()))
        if not satisfied and req.key not in requested_keys:
            missing_undeclared.append(req.key)
    out.append(AssertionResult(
        "S8", "L1", not missing_undeclared,
        "缺数据未申报：" + "、".join(missing_undeclared) if missing_undeclared else "缺数据均已申报",
    ))

    return out


# ============ L2 内容质量（机器可判部分） ============

def _all_numbers(texts: list[str]) -> set[str]:
    nums: set[str] = set()
    for t in texts:
        for m in _NUMBER_TOKEN_RE.findall(t):
            nums.add(m.strip(",.").replace(",", ""))
    return {n for n in nums if n}


def _l2_machine_checks(r: ModuleResult, ctx: EvalContext) -> list[AssertionResult]:
    out: list[AssertionResult] = []
    evidence_texts = [e.text for e in r.evidence]

    # 缺数据降级模式：无证据 + 有数据请求 = skill 正确地"老实说数据不够"。
    # 此时 C1/C6 这类"结论质量"断言不该惩罚它（它本就不该下强结论）。
    # 这是反 Goodhart 的反向保护：不能逼 skill 在没数据时硬凑证据来过 C1。
    defer_mode = not r.evidence and bool(r.data_requests)

    # C1: 至少 1 条 evidence 含数字（降级模式跳过）
    if not defer_mode:
        c1_pass = any(_NUMBER_RE.search(t) for t in evidence_texts)
        if not evidence_texts:
            c1_detail = "无证据"
        elif c1_pass:
            c1_detail = "证据含具体数字"
        else:
            c1_detail = "证据均无具体数字（全是形容词判断）"
        out.append(AssertionResult("C1", "L2", c1_pass, c1_detail))

    # C2: evidence 里的数字必须来自合法来源，否则视为编造。合法来源三类：
    #   1) 用户输入 facts  2) benchmark  3) skill prompt 里声明的行业基准锚点
    # 第3类是关键：skill 说"存活率低于行业健康线75-85%"是专业的内外对比，不是编造。
    # 但锚点必须在 prompt 文本里"字面出现过"才算数，真凭空编的数字仍会被抓。
    anchor_numbers = _all_numbers([ctx.anchor_text]) if ctx.anchor_text else set()
    input_numbers = _all_numbers(list(ctx.answer.facts.values())) | set(ctx.benchmark_numbers) | anchor_numbers
    legal = {x.rstrip("%") for x in input_numbers}
    evidence_numbers = _all_numbers(evidence_texts)
    # 只校验"长得像统计量"的数字（≥2位或带%），单字数字噪音大不查
    significant = {n for n in evidence_numbers if len(n) >= 2 or "%" in n}
    fabricated = {n for n in significant if n.rstrip("%") not in legal}
    out.append(AssertionResult(
        "C2", "L2", not fabricated,
        "疑似编造数字：" + "、".join(list(fabricated)[:3]) if fabricated else "数字均可溯源",
    ))

    # C3: 每条 action 含强动作动词（防"加强协同"这类正确的废话）
    weak_actions = [a for a in r.actions if not any(v in a for v in ACTION_VERBS)]
    out.append(AssertionResult(
        "C3", "L2", not weak_actions,
        "存在不可执行的行动：" + "；".join(weak_actions[:2]) if weak_actions else "行动均含动作动词",
    ))

    # C4: conclusion 不含模板腔
    hit = [p for p in TEMPLATE_PHRASES if p in r.conclusion]
    out.append(AssertionResult(
        "C4", "L2", not hit, "命中模板腔：" + "、".join(hit) if hit else "无模板腔",
    ))

    # C5: action 不与 conclusion 字面重复
    dup = [a for a in r.actions if a.strip() and a.strip() in r.conclusion]
    out.append(AssertionResult(
        "C5", "L2", not dup, "行动与结论重复" if dup else "行动与结论不重复",
    ))

    # C6: 命中行业 KPI（无 KPI 词库时跳过=通过；降级模式跳过）
    if ctx.industry_kpis and not defer_mode:
        haystack = r.conclusion + " ".join(evidence_texts)
        hit_kpi = [k for k in ctx.industry_kpis if k in haystack]
        out.append(AssertionResult(
            "C6", "L2", bool(hit_kpi), "命中行业KPI：" + "、".join(hit_kpi[:3]) if hit_kpi else "未命中任何行业KPI",
        ))

    # C7: 置信度校准
    ep = r.evidence_package
    if ep is not None:
        n_ev = len(r.evidence)
        has_bench = bool(ep.benchmarks)
        if n_ev == 0:
            ok = ep.confidence < 0.5
            why = f"无证据但置信度={ep.confidence}（应<0.5）"
        elif n_ev >= 2 and has_bench:
            ok = True
            why = "证据充分，允许高置信度"
        else:
            ok = ep.confidence <= 0.85
            why = f"证据有限，置信度={ep.confidence}（应≤0.85）"
        out.append(AssertionResult("C7", "L2", ok, why))

    # C8: 信号-结论一致性
    if r.signal == "red":
        ok = any(w in r.conclusion for w in NEGATIVE_WORDS)
        out.append(AssertionResult("C8", "L2", ok, "红灯结论含负面判断" if ok else "红灯但结论无负面判断词"))
    elif r.signal == "green":
        # 绿灯不应只报问题（不强约束，命中负面词过多才扣）
        neg_hits = sum(1 for w in NEGATIVE_WORDS if w in r.conclusion)
        out.append(AssertionResult("C8", "L2", neg_hits <= 1, "绿灯结论基调正常" if neg_hits <= 1 else "绿灯但结论充满负面词"))

    return out


def evaluate_result(r: ModuleResult, ctx: EvalContext) -> EvalReport:
    """对单条诊断结果跑全部 L1+L2 机器断言。"""
    report = EvalReport()
    report.results.extend(_l1_checks(r, ctx))
    report.results.extend(_l2_machine_checks(r, ctx))
    return report
