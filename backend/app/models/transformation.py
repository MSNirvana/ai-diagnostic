"""V2「AI 改造方案」数据模型 —— 按域(问题)一一对应。

每张作战室问题卡(一个 module)配一个改造(DomainTransformation)。
改造分两层:
- 结果层(默认看):redesign_headline + before_after 对比表 + investment
- 实现层(点开看):stages(30 天分周怎么搭)+ prereq_risk

镜像 app/models/warroom.py 的建模风格(BaseModel + Field default + 防御性默认)。
"""
from datetime import datetime

from pydantic import BaseModel, Field


class BeforeAfterRow(BaseModel):
    """改造前后对比表的一行:某个维度的「现在的惨」vs「改造后的爽」。"""
    dimension: str            # 维度:获客 / 信任 / 客户支持 / 决策 / 你的角色 / 本质
    before: str               # 现状(具体、戳痛)
    after: str                # 改造后(具体、可感)


class TransformStage(BaseModel):
    """实现路径的一个阶段(按 30 天分周)。"""
    window: str               # 时间窗:「第 1 周」「第 2-3 周」「第 4 周」「30 天后(可选)」
    result: str               # 这阶段结束能看到的实在结果
    how: str                  # 怎么搭(含具体工具名)
    ai_does: str = ""         # AI 自动干什么
    you_do: str = ""          # 老板只需做什么(轻)
    ai_capabilities: list[str] = Field(default_factory=list)  # 用到的 AI 能力


class DomainTransformation(BaseModel):
    """一个诊断问题(域)的 AI 改造——贴着这张作战室问题卡,把这个环节用 AI 重做一遍。

    锚定就是 module 本身(= 这张问题卡),不再自由复述,天然一一对应。
    """
    module: str                            # 锚定的域 = 作战室那张问题卡
    label: str = ""                        # 域中文名(展示用)
    problem: str = ""                      # 这张卡诊断出的问题原文(锚定回显,不复述)
    redesign_headline: str = ""            # 这个问题被 AI 重做后一句话(激进重构口吻)
    before_after: list[BeforeAfterRow] = Field(default_factory=list)  # 结果层主体
    stages: list[TransformStage] = Field(default_factory=list)         # 实现层(30天分周)
    investment: str = ""                   # 投入一句话(成本band + 时间 + 不需要什么)
    prereq_risk: str = ""                  # 落地前提与风险(诚实标)
    generated: bool = True                 # 是否已成功生成(降级兜底时为 False,前端可提示重试)


class TransformationPlan(BaseModel):
    """项目的 AI 改造方案快照(挂在 project.transformation_plan_json)。

    items: module → 该问题的改造。和作战室问题卡逐一对应。
    """
    id: str
    project_id: str | None = None
    record_id: str | None = None           # 基于哪条诊断记录生成
    created_at: datetime | None = None
    items: dict[str, DomainTransformation] = Field(default_factory=dict)
