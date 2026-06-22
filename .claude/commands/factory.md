---
description: 诊断能力生产线 —— 给定一个"诊断能力"，跑研究→起草→评测→重做循环，产出待人审的能力 skill。
argument-hint: <capability_key> <能力名> <核心诊断问题>
---

# 诊断能力生产线（Loop 1）

为 `$ARGUMENTS` 生产一个**诊断能力 skill**。这是带终止条件和边界的循环，不是单次任务。

> 架构原则（重要）：skill 按**诊断能力**切分，不按行业。一个能力（如"获客投放效率诊断"）
> 通吃 DTC/跨境/本地/B2B——**行业差异靠运行时注入的 benchmark（行业基准）+ scenario（场景）调整，
> prompt 里绝不写死某一个行业的数值**。绝不再造"行业×功能"的笛卡尔积 skill。

## 循环目标（机器可验证的完成标准）

候选通过 `docs/eval/skill_acceptance_v1.md` 闸门：
- **L1 结构合规 100% 通过**（任一挂 = 淘汰）
- **L2 内容质量 ≥ 90% 通过**
- **LLM 判卷各维度 ≥ 0.6**

## 循环边界（不能怎么做）

- 不许把能力绑死到某个行业（prompt 出现"你是XX行业专家"=不合格，应是"你的能力通用，按输入行业调整基准"）
- 不许为了过 C1（证据含数字）而编造数字 —— C2 会抓，判 fail
- 不许删测试样例或放松 assertions 来"让它过"—— Goodhart 作弊
- 缺数据场景必须老实触发 data_request
- 必须收集"真实数据入口"字段（账号/链接/后台），顾问要靠它做外部核验，不是只看老板自述
- 最多重做 5 轮，仍不过标记 failed 存难产库

## 执行步骤

1. **研究**：调 `skill-research` 子 agent，传入 capability_key/能力名/核心问题，研究"这个诊断能力的通用方法、跨行业共性指标、常见误判"，产出 `_research/<capability_key>.json`。**研究的是能力方法，不是某个行业。**

2. **起草**：调 `skill-drafter` 子 agent，产出：
   - `configs/<capability_key>.json`（category=`capability`，含 trigger_keywords / industry_kpis / data_requirements）+ `configs/<capability_key>.prompt.md`（通用诊断方法，按行业调基准）
   - `configs/_tests/<capability_key>.json`（20 个测试样例：覆盖 2-3 个不同行业的同一能力场景，红5黄5绿5缺数据5）

3. **评测**：调 `skill-evaluator` 子 agent（独立判卷，opus）：
   - 跑机器断言：`cd backend && .venv/bin/python -m app.eval.run_eval --skill <capability_key>`
   - 再做 LLM 判卷（额外查：能力是否真通用、有没有偷偷绑行业）
   - 产出 `_eval/<capability_key>.machine.json` + verdict

4. **判定循环**：
   - `pass` → 步骤 5
   - `redo` 且轮次 < 5 → systematic_issues 反馈给 drafter 重做，轮次+1
   - `fail` 或轮次==5 → 标记 failed，报告原因，结束

5. **预审**：调 `skill-critic` 子 agent 做上线前内行检验，产出 `_review/<capability_key>.json`。

6. **报告**：capability_key、最终 verdict、几轮过的、L2 通过率、critic 的 one_line；明确告诉用户**候选进人审队列，签字才上线**。

## 关键纪律

- 评测员和起草员是两个独立 agent，评测员看不到起草员推理。
- 每步向用户报告进展，不闷头跑完才出声。
- 真实 LLM 评测需配 key；无 key 用 `--fake` 先验证管线，并说明"只是管线冒烟"。
- 同一诊断能力会有多种角度/流派（你的要求）——允许为同一问题造不同方法的能力 skill，但每个都要能独立说清自己的诊断方法差异。
