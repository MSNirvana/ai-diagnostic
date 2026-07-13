"""Loop 1 评测运行器 —— 给定 skill key，跑测试样例 + 断言，输出报告。

用法：
  python -m app.eval.run_eval --skill <key>
  python -m app.eval.run_eval --skill <key> --fake   # 用桩LLM冒烟测断言管线

真实评测需要配置 LLM（环境变量或 DB）。--fake 模式用固定输出验证断言管线本身。
"""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from app.eval.assertions import EvalContext, evaluate_result
from app.models.questionnaire import ModuleAnswer
from app.skills.config_loader import CONFIGS_DIR, load_config, load_config_meta
from app.skills.configured import ConfiguredExpertSkill
from app.skills.method import compose_preview

TESTS_DIR = CONFIGS_DIR / "_tests"
EVAL_DIR = CONFIGS_DIR / "_eval"


def _load_cases(key: str) -> dict:
    path = TESTS_DIR / f"{key}.json"
    if not path.exists():
        raise FileNotFoundError(f"test cases not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


async def run_eval(key: str, use_fake: bool = False) -> dict:
    config = load_config(key)
    meta = load_config_meta(key)
    skill = ConfiguredExpertSkill(config)
    cases = _load_cases(key)["cases"]

    industry_kpis = tuple(meta.get("industry_kpis", ()))
    requirements = config.data_requirements
    # 完整 system prompt（领域切片 + 注入的通用方法）+ KPI 词：内含锚点数字，C2 视为合法来源
    anchor_text = compose_preview(config.fallback_prompt) + " " + " ".join(industry_kpis)

    if use_fake:
        from app.eval._fake_llm import FakeDiagnosisLLM
        llm = FakeDiagnosisLLM()
    else:
        # 离线评测显式使用 GGOO_SERVICE_API_KEY，不占用任意 Web 用户身份。
        from app.config import get_llm_client
        llm = await get_llm_client(authorization=None)

    case_reports = []
    l1_all_pass = True
    l2_rates: list[float] = []
    error_count = 0

    for case in cases:
        case_id = case.get("id", "?")
        # 单题失败不拖垮整批：记为该题 fail，继续跑下一题。
        # 这是评测器的硬要求——20 题里第 1 题挂了，后 19 题也必须有结果。
        try:
            answer = ModuleAnswer(**case["input"])
            result, _version = await skill.diagnose(answer, llm, session=None)
        except Exception as e:  # noqa: BLE001
            error_count += 1
            l1_all_pass = False
            l2_rates.append(0.0)
            case_reports.append({
                "case_id": case_id,
                "expected_signal": case.get("expected_signal"),
                "got_signal": "ERROR",
                "l1_passed": False,
                "l2_pass_rate": 0.0,
                "failures": [f"诊断/解析异常: {type(e).__name__}: {str(e)[:160]}"],
            })
            continue
        ctx = EvalContext(
            answer=answer,
            industry_kpis=industry_kpis,
            benchmark_numbers=tuple(_benchmark_numbers(result)),
            requirements=requirements,
            anchor_text=anchor_text,
        )
        report = evaluate_result(result, ctx)
        if not report.l1_passed:
            l1_all_pass = False
        l2_rates.append(report.l2_pass_rate)
        case_reports.append({
            "case_id": case_id,
            "expected_signal": case.get("expected_signal"),
            "got_signal": result.signal,
            "signal_match": result.signal == case.get("expected_signal"),
            "l1_passed": report.l1_passed,
            "l2_pass_rate": round(report.l2_pass_rate, 2),
            "failures": [f"{f.code}: {f.detail}" for f in report.failures],
        })

    overall_l2 = sum(l2_rates) / len(l2_rates) if l2_rates else 0.0
    verdict = "pass" if (l1_all_pass and overall_l2 >= 0.9) else ("redo" if l1_all_pass else "fail")

    signal_hits = sum(1 for c in case_reports if c.get("signal_match"))
    summary = {
        "skill_key": key,
        "case_count": len(cases),
        "error_count": error_count,
        "signal_accuracy": round(signal_hits / len(cases), 2) if cases else 0.0,
        "l1_all_pass": l1_all_pass,
        "l2_overall_rate": round(overall_l2, 3),
        "machine_verdict": verdict,
        "cases": case_reports,
    }

    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    out_path = EVAL_DIR / f"{key}.machine.json"
    out_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def _benchmark_numbers(result) -> list[str]:
    import re
    nums: list[str] = []
    ep = result.evidence_package
    if ep:
        for b in ep.benchmarks:
            nums.extend(re.findall(r"\d[\d,\.]*%?", b.value))
    return [n.strip(",.").replace(",", "") for n in nums]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skill", required=True)
    parser.add_argument("--fake", action="store_true")
    args = parser.parse_args()
    summary = asyncio.run(run_eval(args.skill, use_fake=args.fake))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\n=== machine_verdict: {summary['machine_verdict']} "
          f"(L1={'PASS' if summary['l1_all_pass'] else 'FAIL'}, "
          f"L2={summary['l2_overall_rate']:.0%}, "
          f"信号准确率={summary['signal_accuracy']:.0%}, "
          f"异常题数={summary['error_count']}) ===")


if __name__ == "__main__":
    main()
