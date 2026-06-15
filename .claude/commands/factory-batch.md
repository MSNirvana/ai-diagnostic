---
description: 批量跑 Skill 生产线 —— 读 skill_matrix.csv，对每行(行业,功能,场景)跑 /factory，汇总通过率。
argument-hint: [matrix文件路径，默认 .claude/skill_matrix.csv]
---

# 批量 Skill 生产（Loop 1 跑批）

读 `${ARGUMENTS:-.claude/skill_matrix.csv}`，对每一行跑一遍 `/factory` 的循环。这是夜里无人值守跑 30-100 个 skill 的入口。

## CSV 格式

```
industry,function,scenario,priority
DTC美妆电商,投放,广告ROI与获客成本诊断,1
连锁餐饮,渠道,加盟单店模型与招商效率诊断,1
新能源厨电,合规,商用场景资质与广告合规诊断,2
```

## 执行策略

1. 读 CSV，按 priority 升序排队。
2. **幂等去重（关键，避免重复造 + 覆盖已上线的）**：对每一行先算出 skill key（行业_功能，转拼音/英文小写下划线），再判断该跳过还是该造：
   - `configs/<key>.json` 存在 **且** `configs/_review/<key>.json` 里 `review_status == "approved"`（已人审通过/已上线）→ **跳过**，不重造（重造会覆盖沉淀的案例 few-shot）。
   - `configs/<key>.json` 存在但仍是草稿（无 approved 标记）→ 默认**跳过并提示**；仅当用户在参数里传 `--force` 时才重造刷新。
   - `configs/<key>.json` 不存在 → 正常造（新行）。
   - 跳过的行也要进最终报告的「已跳过」清单，让用户清楚这次实际造了几个、跳了几个。
3. **并行跑**：对需要造的行，用 dispatching-parallel-agents 的方式，一次并发 3-5 个 `/factory`（每个是独立的 research→draft→eval→critic 链）。不要串行，浪费算力。
4. 每个 skill 产出后，记录到汇总表：`key | verdict | rounds | L2率 | critic建议`。
5. 全部跑完，输出：
   - 本次新造 X / 跳过 Y(已上线) / 跳过 Z(草稿，可 --force 刷新)
   - 总数 / pass / redo超限failed / 分布
   - **进人审队列的候选清单**（verdict=pass 的）
   - **难产清单**（failed 的，附原因，作为下次起草的反面教材）

## 边界

- 单个 skill 失败不影响其他 —— 一个挂了继续跑下一个，最后统一报告。
- 不允许为了拉高批量通过率而放松任何 assertion（Goodhart 红线）。
- 跑批只产出**候选**。人审签字才上线，这条不可跳过——咨询没有客观验证器，前期必须人在 loop 里。

## 报告口径

最后明确告诉用户三个数：
1. 这批跑出多少个**待人审候选**（不是"上线了多少"）
2. 多少个进了**难产库**
3. 你预计**人审需要多久**（按 5 分钟/候选估）
