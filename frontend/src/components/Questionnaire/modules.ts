export interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
}

export interface ModuleDef {
  key: string;
  label: string;
  subtitle: string;        // 模块一句话说明
  fields: FieldDef[];      // 结构化输入字段
  freeTextLabel: string;   // 自由文字框的标签
  acceptFiles: boolean;    // 是否支持文件上传
  pains: string[];         // 痛点选项
}

export const MODULES: ModuleDef[] = [
  {
    key: "market",
    label: "市场与客户",
    subtitle: "你在市场里的位置与竞争态势",
    acceptFiles: true,
    fields: [
      { key: "公司名称", label: "公司名称", placeholder: "如：杭州明远科技有限公司" },
      { key: "主营产品服务", label: "主营产品/服务", placeholder: "如：面向中小企业的SaaS财务软件" },
      { key: "目标用户群", label: "目标用户群", placeholder: "如：年营收500万-5000万的制造业企业", hint: "越具体越好，包含行业、规模、地域" },
      { key: "主要产品定价", label: "主要产品定价", placeholder: "如：客单价 420元/月，年付享8折" },
      { key: "主要竞品", label: "主要竞品", placeholder: "如：用友、金蝶云、某某SaaS（列2-3家）" },
      { key: "估计市场份额", label: "估计市场份额", placeholder: "如：在华东中小企业市场约占3%", hint: "没有精确数字可写区间或大致排名" },
    ],
    freeTextLabel: "补充说明：竞争格局、客户反馈、近期市场变化等",
    pains: ["打不过竞品", "客户在流失", "市场在萎缩", "找不到精准客户"],
  },
  {
    key: "product",
    label: "产品与服务",
    subtitle: "你的产品凭什么被选择、被复购",
    acceptFiles: false,
    fields: [
      { key: "核心产品", label: "核心产品", placeholder: "如：智能排产模块 + 数据看板" },
      { key: "产品构成", label: "产品原材料/构成", placeholder: "如：自研算法引擎 + 第三方云服务 + 硬件采集盒" },
      { key: "研发投入占比", label: "研发投入占比", placeholder: "如：研发费用约占营收18%", hint: "营收中投入研发的比例" },
      { key: "迭代周期", label: "迭代周期", placeholder: "如：每两周一次小版本，每季度一次大版本" },
      { key: "产品差异化卖点", label: "产品差异化卖点", placeholder: "如：唯一支持离线部署，落地速度比竞品快3倍", hint: "客户为什么选你而不是竞品" },
    ],
    freeTextLabel: "补充说明：技术壁垒、客户使用反馈、产品规划等",
    pains: ["产品同质化", "迭代太慢", "缺乏核心技术", "客户用不起来"],
  },
  {
    key: "sales",
    label: "营销与销售",
    subtitle: "你怎么把产品卖出去、卖得划算",
    acceptFiles: true,
    fields: [
      { key: "主要获客渠道", label: "主要获客渠道", placeholder: "如：线下展会40%、SEM30%、转介绍30%" },
      { key: "获客成本", label: "获客成本(CAC)", placeholder: "如：单个有效客户约 1800元", hint: "获取一个付费客户的平均花费" },
      { key: "转化率", label: "转化率", placeholder: "如：线索到成交约 8%" },
      { key: "客单价", label: "客单价", placeholder: "如：首单平均 5000元/年" },
      { key: "销售团队规模", label: "销售团队规模", placeholder: "如：销售12人 + 售前3人" },
      { key: "上季度营收", label: "上季度营收", placeholder: "如：Q1 营收约 320万元" },
    ],
    freeTextLabel: "补充说明：渠道效果、销售瓶颈、客户成交周期等",
    pains: ["获客太贵", "转化率低", "过度依赖单一渠道", "销售周期太长"],
  },
  {
    key: "ops",
    label: "运营与供应链",
    subtitle: "你的交付与成本是否健康",
    acceptFiles: true,
    fields: [
      { key: "平均交付周期", label: "平均交付周期", placeholder: "如：从下单到交付平均 15天" },
      { key: "主要成本构成", label: "主要成本构成", placeholder: "如：原材料45%、人力30%、物流15%", hint: "占比最大的几项成本" },
      { key: "产能利用率", label: "产能利用率", placeholder: "如：当前产能利用率约 70%" },
      { key: "供应商数量", label: "供应商数量", placeholder: "如：核心供应商5家，其中2家占采购量70%" },
      { key: "库存周转", label: "库存周转", placeholder: "如：库存周转天数约 45天" },
    ],
    freeTextLabel: "补充说明：交付瓶颈、供应链风险、成本压力等",
    pains: ["成本过高", "交付太慢", "产能瓶颈", "供应链不稳定"],
  },
  {
    key: "org",
    label: "组织与人才",
    subtitle: "你的团队能不能扛住增长",
    acceptFiles: false,
    fields: [
      { key: "员工总数", label: "员工总数", placeholder: "如：全职58人，外包8人" },
      { key: "组织架构", label: "组织架构", placeholder: "如：研发/销售/交付/职能 四大部门，5名中层" },
      { key: "人均产值", label: "人均产值", placeholder: "如：人均年营收约 40万元", hint: "年营收 ÷ 员工总数" },
      { key: "核心岗位空缺", label: "核心岗位空缺", placeholder: "如：缺1名销售总监、2名高级工程师" },
      { key: "年度流失率", label: "年度流失率", placeholder: "如：年流失率约 22%，研发岗偏高" },
    ],
    freeTextLabel: "补充说明：团队短板、激励机制、招聘难点等",
    pains: ["人效低", "留不住人", "组织臃肿", "缺关键人才"],
  },
  {
    key: "finance",
    label: "财务与资本",
    subtitle: "你的钱袋子是否撑得起未来",
    acceptFiles: true,
    fields: [
      { key: "上年度营收", label: "上年度营收", placeholder: "如：2025年营收约 1200万元" },
      { key: "毛利率", label: "毛利率", placeholder: "如：综合毛利率约 55%" },
      { key: "净利率", label: "净利率", placeholder: "如：净利率约 8%，去年同期5%" },
      { key: "现金流状况", label: "现金流状况", placeholder: "如：账上现金可支撑约 9个月", hint: "可写经营性现金流或可用月数" },
      { key: "负债率", label: "负债率", placeholder: "如：资产负债率约 40%" },
      { key: "融资轮次", label: "融资轮次", placeholder: "如：已完成天使轮，正筹备Pre-A" },
    ],
    freeTextLabel: "补充说明：盈利模式、资金压力、融资计划等",
    pains: ["现金流紧张", "不盈利", "应收账款高", "融资困难"],
  },
];

import type { GeneratedModule } from "../../types";

export const MODULES_AS_GENERATED: GeneratedModule[] = MODULES.map((m) => ({
  key: m.key,
  label: m.label,
  subtitle: m.subtitle,
  fields: m.fields.map((f) => ({
    key: f.key,
    label: f.label,
    placeholder: f.placeholder,
    hint: f.hint,
    accept_file: m.acceptFiles,
  })),
  pains: m.pains,
  free_text_label: m.freeTextLabel,
}));
