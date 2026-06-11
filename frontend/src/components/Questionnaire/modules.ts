export interface ModuleDef {
  key: string;
  label: string;
  facts: { key: string; label: string }[];
  pains: string[];
}

export const MODULES: ModuleDef[] = [
  { key: "market", label: "市场与客户",
    facts: [{ key: "客单价", label: "平均客单价" }, { key: "主要竞品", label: "主要竞品" }],
    pains: ["打不过竞品", "客户在流失", "市场在萎缩"] },
  { key: "product", label: "产品与服务",
    facts: [{ key: "主力产品", label: "主力产品" }], pains: ["产品同质化", "迭代太慢"] },
  { key: "sales", label: "营销与销售",
    facts: [{ key: "获客成本", label: "获客成本" }], pains: ["获客太贵", "转化率低"] },
  { key: "ops", label: "运营与供应链",
    facts: [{ key: "交付周期", label: "平均交付周期" }], pains: ["成本过高", "交付太慢"] },
  { key: "org", label: "组织与人才",
    facts: [{ key: "员工数", label: "员工总数" }], pains: ["人效低", "留不住人"] },
  { key: "finance", label: "财务与资本",
    facts: [{ key: "毛利率", label: "毛利率" }], pains: ["现金流紧张", "不盈利"] },
];
