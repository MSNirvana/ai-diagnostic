export interface Evidence {
  text: string;
  source: string;
}
export interface DrillDown {
  data_points: Evidence[];
  comparisons: string[];
}
export type Signal = "red" | "yellow" | "green";
export interface ModuleResult {
  module: string;
  signal: Signal;
  conclusion: string;
  evidence: Evidence[];
  actions: string[];
  drilldown: DrillDown | null;
}
export interface ModuleAnswer {
  module: string;
  facts: Record<string, string>;
  pains: string[];
  uploaded_files?: string[];
}
