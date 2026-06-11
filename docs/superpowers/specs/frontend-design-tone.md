# 前端设计基调：浅色沉稳咨询风

> 用于 AI 咨询诊断系统前端。所有组件遵循此基调。参照 frontend-design 原则：鲜明、克制、不用泛泛的 AI 风。

## 调性
权威、沉稳、可信赖——像麦肯锡级咨询报告的数字化呈现。给企业老板和投资人看。克制优于花哨。

## 配色（CSS 变量）
```css
:root {
  --bg: #FAF8F5;          /* 米白底，温暖不刺眼 */
  --surface: #FFFFFF;     /* 卡片面 */
  --ink: #1F2A37;         /* 主文字：深蓝灰 */
  --ink-soft: #5B6675;    /* 次要文字 */
  --line: #E6E1DA;        /* 分隔线 */
  --accent: #2C5F6F;      /* 强调：沉稳青灰蓝 */
  --signal-red: #B23A48;   /* 红：暗红，不刺眼 */
  --signal-amber: #C8852B; /* 黄：琥珀 */
  --signal-green: #3E7A5A; /* 绿：墨绿 */
}
```

## 字体
- 标题：衬线体（咨询报告权威感）。`"Noto Serif SC", "Songti SC", Georgia, serif`
- 正文：无衬线（清晰）。`"Noto Sans SC", -apple-system, "PingFang SC", sans-serif`

## 布局
- 大量留白；内容最大宽度约 960–1100px 居中
- 看板用卡片网格（响应式：宽屏多列，窄屏单列）
- 信息分层：信号 → 结论 → 证据 → 行动 → 下钻

## 信号灯
不用 emoji。用沉稳的色块圆点 + 文字徽章（红/琥珀/墨绿对应上面变量）。

## 动效（克制）
- 卡片载入淡入 + 轻微上移（staggered，animation-delay 错开）
- 下钻展开平滑（max-height / opacity 过渡）
- 不用浮夸的弹跳、旋转
