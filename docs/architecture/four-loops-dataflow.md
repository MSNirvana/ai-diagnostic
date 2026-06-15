# 睿策视界 · 四 Loop 完整数据流图

- 日期：2026-06-15
- 作用：一张图讲清整个系统怎么自我进化。对外讲架构、对内对齐串接点，都看这张。
- 原则：图与代码逐行对得上。改了串接点就回来改这张图。

> 思想来源：Loop Engineering —— 不再给 Agent 写单次 prompt，而是设计自驱循环（目标+验证+边界+降级）。
> 核心能力不是工程，是**定义目标**：把模糊意图翻译成机器可验证的完成标准。
> 唯一会死的方式是 Goodhart 定律：Agent 针对验证器优化，而非真实价值。全系统的防线是 L1 考试闸门。

---

## 一、实时主链路（老板点"开始诊断"那一刻，代码真实顺序）

```
老板提交问卷 + 上传数据
POST /diagnose  (diagnose.py:147)
        │
        ▼
┌─────────────────────────────────────────────────┐
│ diagnose_all()  (dispatcher.py)                  │
│  ① _route_experts 召回 skill（关键词打分）         │  ← Router 召回
│  ② 并行跑各 skill.diagnose()                       │
│  ③ scrub_method_language 护城河过滤                │
│  ④ _summarize_triage 选主战场/冲突/依赖            │
└──────┬───────────────────────────────┬───────────┘
       │                               │ outcome(results+triage)
   ┌───▼─────────────┐                 │
   │ L2 收集器        │                 ▼
   │ collect_routing_ │     ┌───────────────────────────┐
   │ sample (disp:58) │     │ compose_war_room_plan()    │
   └───┬─────────────┘     │ 确定性骨架（战场/优先级/    │
       │                   │ 指标/依赖图）— 永远先出方案 │
  写入 RoutingSample 表     └────────────┬──────────────┘
  (problem_text/召回打分/                ▼
   实际跑了谁/漏召回)         ┌───────────────────────────┐
                            │ enhance_war_room_plan()    │  ← L4
                            │ LLM 重写叙事 → critic 把关  │
                            │ 套话/编造→回退；网关挂→降级 │
                            └────────────┬──────────────┘
                                         ▼
                            ┌───────────────────────────┐
                            │ _save_history()            │
                            │ 登录用户→DiagnosisRecord    │
                            │ (原始数据，仅本人可见)       │
                            └────────────┬──────────────┘
                                         ▼
                            ┌───────────────────────────┐
                            │ L3 archive_case()          │  ← L3
                            │ 脱敏(去名/金额模糊)         │
                            │ →结构化→写 CaseAsset 表     │
                            │ 登录+匿名都归档，旁路容错    │
                            └────────────┬──────────────┘
                                         ▼
                            返回作战室给老板（30秒看懂开会）
```

**关键纪律：实时链路只"采集"不"训练"。** L2 写样本、L3 写案例都是 best-effort 旁路——
失败绝不挡老板拿方案。loop 自动跑、你不在场，所以每一环都不能因一个 503 崩掉。

---

## 二、离线训练链路（夜里在 Claude Code 跑，用户无感）

```
L1 Skill 生产线（造新 skill）
  skill_matrix.csv（行业×功能×场景清单）
      │  /factory 或 /factory-batch
      ▼
  ① skill-research  → 行业KPI/判断规则/陷阱
  ② skill-drafter   → ExpertConfig + 20考题
  ③ skill-evaluator → run_eval 跑16断言 + LLM判卷（独立agent，学生不批自己卷子）
      │ 不过(≤5轮)──反馈──┘   │ 过
  ④ skill-critic    → 内行预审
      ▼
  人审签字 → configs/<key>.json →【文件即上线，registry 自动加载】
      │
      ▼ 新 skill 进入 registry（13→15→…100+）
  ┌──────────────────┐
  │ registry          │ ◄─────────────┐
  └──────────────────┘                │ 反哺
                                       │
L2 Router 训练（召回越用越准）           │
  RoutingSample 表（实时链路攒的样本）    │
   │ 攒够 N 条，离线分析                  │
  高分召回却 green = 关键词假阳性→调权重   │
  手填+red 却漏召回 = 关键词缺口→补trigger │
   └ 更新 skill 的 trigger_keywords ─────┤
                                       │
L3 案例飞轮（案例反哺 skill）             │
  CaseAsset 表（实时链路攒的脱敏案例）     │
   │ 7/14/30天复盘回填 effectiveness_score│
  有效案例→few-shot候选→eval验证是否提升   │
   └ 提升→skill版本bump(草稿)→人审→上线 ──┘
  无效案例→难产库，做 hard negative
```

---

## 三、两张图怎么咬合（这才是飞轮）

```
      实时链路                          离线链路
 ┌──────────────┐                  ┌──────────────┐
 │ 每次诊断       │ ──采集样本──→     │ L2 调 router  │
 │ (老板用)      │   RoutingSample   │ L3 炼案例     │
 │              │   CaseAsset       │ L1 造新skill  │
 │              │ ◄─更准的系统──    │ (夜里跑)      │
 └──────────────┘                  └──────────────┘
      ▲                                    │
      └────── 客户越多，料越多，系统越懂行 ──┘
               （竞品抄代码抄不走这个）
```

**一句话：实时链路是"采集口 + 交付口"，离线链路是"炼料厂"。**
老板每用一次，给三个 Loop 各喂一勺料；炼料厂夜里炼成更准的 router、更深的案例库、更多 skill，
反哺回 registry。你白天定标准签字，系统夜里自己进化。

---

## 四、四个 Loop 的归属（对得上代码）

| Loop | 实时部分（代码里） | 离线部分（Claude Code） | 状态 |
|---|---|---|---|
| **L1 Skill 生产线** | registry 自动加载 configs/ | 4 agent 造 skill + eval 闸门 | ✅ |
| **L2 Router** | dispatcher 写 RoutingSample | 攒样本调关键词权重 | 🔀 表+收集器已接 |
| **L3 案例飞轮** | diagnose 写 CaseAsset | 复盘回填→few-shot→版本bump | ✅ 采集端完成 |
| **L4 Composer** | enhance_war_room_plan | （无，纯实时） | ✅ |

**贯穿全图的命门：L1 考试闸门**（`backend/app/eval/assertions.py` + `docs/eval/skill_acceptance_v1.md`）。
L1 造 skill 要过它、L3 案例升级 skill 要过它、L2 调完权重也要回归测试。
它是所有"自动进化"的总质检，**防 Goodhart 的唯一防线**。

---

## 五、关键文件索引

| 环节 | 文件 |
|---|---|
| 考试标准 | `docs/eval/skill_acceptance_v1.md` |
| 断言库（16条） | `backend/app/eval/assertions.py` |
| 评测运行器 | `backend/app/eval/run_eval.py` |
| skill 配置加载（文件即上线） | `backend/app/skills/config_loader.py` |
| L1 生产线 agent/命令 | `.claude/agents/skill-*.md`、`.claude/commands/factory*.md` |
| L2 收集器 | `backend/app/orchestrator/routing_collector.py`（fork 窗口） |
| L3 脱敏器 | `backend/app/cases/anonymizer.py` |
| L3 归档器 | `backend/app/cases/archiver.py` |
| L4 增强器 | `backend/app/warroom/enhancer.py` |
| 确定性骨架 | `backend/app/warroom/composer.py` |
