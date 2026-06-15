---
description: Skill 生产线 —— 给定(行业,功能,场景)，跑研究→起草→评测→重做循环，产出一个待人审的 skill 候选。
argument-hint: <行业> <功能> <场景一句话>
---

# Skill 生产线（Loop 1）

为 `$ARGUMENTS` 生产一个诊断 skill。这是一个带终止条件和边界的循环，不是单次任务。

## 循环目标（机器可验证的完成标准）

候选 skill 通过 `docs/eval/skill_acceptance_v1.md` 定义的闸门：
- **L1 结构合规 100% 通过**（任一挂 = 淘汰）
- **L2 内容质量 ≥ 90% 通过**
- **LLM 判卷各维度 ≥ 0.6**

## 循环边界（不能怎么做）

- 不许为了过 C1（证据含数字）而编造数字 —— 这正是 C2 要抓的，会被判 fail
- 不许删测试样例或放松 assertions 来"让它过"—— 这是 Goodhart 作弊
- 缺数据场景必须老实触发 data_request，不许硬给结论
- 最多重做 5 轮，仍不过则标记 failed 存入难产库，不无限循环

## 执行步骤

1. **研究**：调用 `skill-research` 子 agent，传入行业/功能/场景，产出研究简报到 `_research/<key>.json`。

2. **起草**：调用 `skill-drafter` 子 agent，读研究简报，产出：
   - `configs/<key>.json` + `configs/<key>.prompt.md`（skill 配置）
   - `configs/_tests/<key>.json`（20 个测试样例：红5黄5绿5缺数据5）

3. **评测**：调用 `skill-evaluator` 子 agent（独立判卷，opus）：
   - 先跑机器断言：`cd backend && .venv/bin/python -m app.eval.run_eval --skill <key>`
   - 再做 LLM 判卷
   - 产出 `_eval/<key>.json`，给出 verdict

4. **判定循环**：
   - `verdict == pass` → 进步骤 5
   - `verdict == redo` 且轮次 < 5 → 把 `systematic_issues` 反馈给 `skill-drafter` 重做（回步骤 2），轮次+1
   - `verdict == fail` 或 轮次 == 5 → 标记 failed，把候选移到 `_failed/`，报告原因，结束

5. **预审**：调用 `skill-critic` 子 agent 做上线前内行检验，产出 `_review/<key>.json`。

6. **报告**：输出一句话总结：
   - skill key、最终 verdict、几轮过的、L2 通过率、critic 的 one_line
   - 明确告诉用户：**这个候选已进人审队列，等你签字才上线**（人审不可跳过）

## 关键纪律

- 评测员和起草员是**两个独立 agent**，评测员看不到起草员的推理——学生不能自己批卷子。
- 每一步都向用户报告进展（研究完/起草完/第几轮评测/结果），不要闷头跑完才出声。
- 真实 LLM 评测需要配 key；若环境无 key，用 `--fake` 先验证管线，并明确告诉用户"这只是管线冒烟，不是真实质量评测"。
