import { useState } from "react";
import type { ResearchEvidenceOut } from "../../types";
import { cleanDisplayText, displayModuleLabel } from "../../utils/displayText";
import "./EvidencePackPanel.css";

interface EvidencePackPanelProps {
  evidence: ResearchEvidenceOut[];
  title?: string;
  emptyText?: string;
  compact?: boolean;
}

const STAGE_LABELS: Record<string, string> = {
  system_pre_research: "系统预研",
  expert_supplemental_research: "专家追搜",
};

const SOURCE_LABELS: Record<string, string> = {
  policy: "政策",
  news: "新闻",
  platform: "平台",
  web: "网页",
  web_summary: "搜索摘要",
};

interface EvidenceInsight {
  module: string;
  title: string;
  statement: string;
  risk: string;
  sourceIndexes: number[];
  credibility: number;
}

interface EvidenceOverview {
  problem: string;
  conclusion: string;
  auditPurpose: string;
}

export function EvidencePackPanel({
  evidence,
  title = "尽调证据包",
  emptyText = "暂无外部证据。新诊断完成预研后，这里会沉淀可追溯来源。",
  compact = false,
}: EvidencePackPanelProps) {
  const [auditOpen, setAuditOpen] = useState(false);
  const supplementalCount = evidence.filter((item) => item.source_stage === "expert_supplemental_research").length;
  const relevantEvidence = evidence.filter((item) => relevanceScore(item) > 0);
  const averageCredibility = relevantEvidence.length
    ? Math.round(relevantEvidence.reduce((sum, item) => sum + item.credibility, 0) / relevantEvidence.length * 100)
    : 0;
  const insights = buildEvidenceInsights(evidence, compact ? 4 : 6);
  const overview = buildEvidenceOverview(evidence, insights);
  const visibleSources = evidence.slice(0, compact ? 4 : 10);

  return (
    <section className={compact ? "evidence-pack evidence-pack--compact" : "evidence-pack"}>
      <div className="evidence-pack__head">
        <div>
          <span>尽调证据</span>
          <h3>{title}</h3>
        </div>
        <div className="evidence-pack__stats">
          <strong>{evidence.length}</strong>
          <em>入库来源</em>
          {evidence.length > 0 && <em>有效引用 {relevantEvidence.length}</em>}
          {relevantEvidence.length > 0 && <em>平均支撑度 {averageCredibility}%</em>}
        </div>
      </div>

      {evidence.length === 0 ? (
        <p className="evidence-pack__empty">{emptyText}</p>
      ) : (
        <>
          <div className="evidence-pack__summary">
            <span>{supplementalCount > 0 ? `${supplementalCount} 条专家追搜` : "以系统预研为主"}</span>
            <span>{uniqueModules(evidence).join(" / ") || "通用"}</span>
          </div>
          <div className="evidence-analysis">
            <div className="evidence-analysis__head">
              <div>
                <span>融合分析</span>
                <h4>证据分析报告</h4>
              </div>
              <p>已将公开网页、行业信息和政策材料融合成判断点；原始网页与检索轨迹默认收进审计底稿。</p>
            </div>

            <div className="evidence-overview" aria-label="证据包总览">
              <div>
                <span>诊断问题</span>
                <p>{overview.problem}</p>
              </div>
              <div>
                <span>核心结论</span>
                <p>{overview.conclusion}</p>
              </div>
              <div>
                <span>审核目的</span>
                <p>{overview.auditPurpose}</p>
              </div>
            </div>

            <div className="evidence-analysis__grid">
              {insights.map((insight) => (
                <article key={`${insight.module}-${insight.title}`} className="evidence-insight">
                  <div className="evidence-insight__meta">
                    <span>{displayModuleLabel(insight.module) || insight.module || "通用"}</span>
                    <strong>支撑度 {Math.round(insight.credibility * 100)}%</strong>
                  </div>
                  <h4>{insight.title}</h4>
                  <p>
                    {ensurePeriod(insight.statement)}
                    {insight.sourceIndexes.map((index) => (
                      <a
                        key={index}
                        className="evidence-source-ref"
                        href={evidence[index - 1]?.url || undefined}
                        target={evidence[index - 1]?.url ? "_blank" : undefined}
                        rel={evidence[index - 1]?.url ? "noreferrer" : undefined}
                        aria-label={`查看来源 ${index}`}
                      >
                        来源 {index}
                      </a>
                    ))}
                  </p>
                  <div className="evidence-insight__risk">
                    <strong>风险提示：</strong>
                    <span>{insight.risk}</span>
                  </div>
                </article>
              ))}
            </div>

            <div className="evidence-analysis__gaps">
              <strong>需要补充的数据</strong>
              <p>{buildDataGapText(evidence)}</p>
            </div>
          </div>

          <details
            className="evidence-audit-trail"
            open={auditOpen}
            onToggle={(event) => setAuditOpen(event.currentTarget.open)}
          >
            <summary>{evidence.length} 条原始证据已归档，展开查看审计底稿</summary>
            {auditOpen && (
              <>
                <div className="evidence-audit-trail__list">
                  {visibleSources.map((item, index) => (
                    <article key={item.id} className="evidence-audit-item">
                      <div className="evidence-audit-item__meta">
                        <span>来源 {index + 1}</span>
                        <span>{STAGE_LABELS[item.source_stage] ?? item.source_stage}</span>
                        <span>{SOURCE_LABELS[item.source_type] ?? item.source_type}</span>
                        <strong>可信度 {Math.round(item.credibility * 100)}%</strong>
                      </div>
                      <h4>
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noreferrer">
                            {cleanDisplayText(item.title, item.url)}
                          </a>
                        ) : (
                          cleanDisplayText(item.title, "搜索摘要")
                        )}
                      </h4>
                      <p>{cleanDisplayText(item.snippet, "暂无摘要。")}</p>
                      {item.query && <small>检索问题：{cleanDisplayText(item.query, "")}</small>}
                    </article>
                  ))}
                </div>
                {evidence.length > visibleSources.length && (
                  <p className="evidence-pack__more">还有 {evidence.length - visibleSources.length} 条证据已归档，后续可进入证据库筛选查看。</p>
                )}
              </>
            )}
          </details>
        </>
      )}
    </section>
  );
}

function buildEvidenceInsights(evidence: ResearchEvidenceOut[], limit: number): EvidenceInsight[] {
  const ranked = evidence
    .map((item, index) => ({ item, index: index + 1, score: relevanceScore(item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.item.credibility - a.item.credibility);

  const topicSpecs = [
    {
      key: "franchise",
      title: "招商承诺需要先证据化核验",
      pattern: /招商|加盟|回本|代理|渠道|C位|万亿市场|共享|合作伙伴/,
      statement: "公开资料能看到招商、加盟、市场空间或回本相关表达，说明品牌正在使用增长叙事获客；但这些内容更适合作为宣传口径核验线索，不能直接证明代理可复制赚钱。",
      risk: "若未核验合同边界、真实回本周期和代理流水，继续放量招商会把获客问题放大成合规与交付风险。",
    },
    {
      key: "channel",
      title: "渠道规模宣称需要用真实动销校准",
      pattern: /代理商|渠道方|线下代理|店铺|销量|动销|复购|首年|网络|直营/,
      statement: "公开来源提到销量、渠道方或代理网络规模，能够说明品牌对外塑造了渠道扩张预期；但这仍然不能替代区域代理的进货、库存、复购和终端成交数据。",
      risk: "如果只看渠道数量而不看动销质量，容易误判市场需求，导致继续压货、投放和招商。",
    },
    {
      key: "compliance",
      title: "政策与认证只能作为合规背景",
      pattern: /政策|资质|许可|认证|CQC|监管|安全|能源|国家能源局|隐患|问题灶具/,
      statement: "政策、认证和安全类来源能说明品类具备合规与安全叙事空间，也能提示宣传材料应被审查；但这些证据不能直接证明单个品牌、单个代理区域的经营可行性。",
      risk: "交付前应把产品认证、宣传素材、招商页和合同条款逐条对齐，避免把宏观政策利好误用成招商承诺。",
    },
    {
      key: "competition",
      title: "竞品招商热度存在，但不是需求证明",
      pattern: /竞品|火王|国爱|GOAI|评价|投诉|招商会|经销商|智能灶/,
      statement: "竞品招商会、公开活动和评价信息说明市场上有同类招商动作，具备横向比较价值；但仍需要比较价格、技术卖点、渠道政策和售后承接能力。",
      risk: "竞品热度只能作为市场信号，不能替代本项目推广账号、线索质量和成交转化数据。",
    },
  ];

  const insights: EvidenceInsight[] = [];
  for (const spec of topicSpecs) {
    const matches = ranked
      .filter((entry) => spec.pattern.test(sourceContentText(entry.item)))
      .slice(0, 3);
    if (!matches.length) continue;
    const credibility = matches.reduce((sum, entry) => sum + entry.item.credibility, 0) / matches.length;
    insights.push({
      module: matches[0].item.module || "overall",
      title: spec.title,
      statement: spec.statement,
      risk: spec.risk,
      sourceIndexes: matches.map((entry) => entry.index),
      credibility,
    });
  }

  if (insights.length === 0) {
    const grouped = new Map<string, ResearchEvidenceOut[]>();
    for (const item of evidence) {
      const key = item.module || "overall";
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }

    for (const [module, items] of grouped.entries()) {
      const sorted = [...items].sort((a, b) => b.credibility - a.credibility);
      const sourceIndexes = sorted
        .slice(0, 3)
        .map((item) => evidence.findIndex((source) => source.id === item.id) + 1)
        .filter((index) => index > 0);
      const statement = summarizeGenericSources(sorted);
      const avg = sorted.reduce((sum, item) => sum + item.credibility, 0) / sorted.length;

      insights.push({
        module,
        title: `${displayModuleLabel(module) || module || "外部"}关键判断`,
        statement,
        risk: buildRiskText(module, statement),
        sourceIndexes,
        credibility: avg,
      });
    }
  }

  return insights.slice(0, limit);
}

function evidenceText(item: ResearchEvidenceOut) {
  return `${item.query} ${item.title} ${item.snippet}`;
}

function sourceContentText(item: ResearchEvidenceOut) {
  return `${item.title} ${item.snippet}`;
}

function relevanceScore(item: ResearchEvidenceOut) {
  const text = evidenceText(item);
  const content = sourceContentText(item);
  if (/Cadillac|Certified Pre-Owned Vehicles|Harvey/i.test(text)) return 0;
  if (/亿邦动力|新华网|财经频道|央广网|新闻活动|caixin\.com/i.test(content) && !/华火|电火灶|电燃灶|厨电|灶|火王|国爱|GOAI/.test(content)) return 0;
  if (!cleanDisplayText(item.snippet, "") && !/华火|电火灶|电燃灶|厨电|灶|火王|国爱|GOAI/.test(content)) return 0;

  let score = item.credibility * 0.7;
  if (/华火|电火灶|电燃灶|新能源厨电|智能灶|国爱|GOAI|火王/.test(content)) score += 2.2;
  if (/招商|加盟|回本|代理|渠道|经销商|动销|复购|资质|认证|政策|合规|竞品|投诉|评价|安全|隐患|销量/.test(content)) score += 1.3;
  if (/华火|电火灶|电燃灶|新能源厨电|智能灶|国爱|GOAI|火王/.test(item.query) && score > item.credibility) score += 0.25;
  if (/国家能源局|电力业务资质许可|新能源高质量发展|习近平新时代|党中央|国务院/.test(content) && !/电火灶|厨电|华火|国爱|火王|灶具/.test(content)) score -= 2.2;
  return score;
}

function buildEvidenceOverview(evidence: ResearchEvidenceOut[], insights: EvidenceInsight[]): EvidenceOverview {
  const text = evidence.map(evidenceText).join(" ");
  const hasElectricStove = /华火|电火灶|电燃灶|新能源厨电|火王|国爱|GOAI/.test(text);
  const hasFranchise = /招商|加盟|代理|渠道|回本|经销商/.test(text);
  const hasCompliance = /认证|CQC|政策|监管|安全|隐患|问题灶具/.test(text);
  const hasCompetition = /竞品|火王|国爱|评价|投诉|招商会/.test(text);

  if (hasElectricStove && (hasFranchise || hasCompliance || hasCompetition)) {
    return {
      problem: "本证据包重点回答：电火灶项目的招商增长叙事、渠道规模宣称、合规安全背书和竞品信号，是否足以支撑继续放量获客与招商决策。",
      conclusion: "当前公开证据能证明市场上存在品牌推广、招商动作、渠道扩张和安全合规叙事，但不能证明代理模型已经被真实动销、回本周期和区域经营数据验证。",
      auditPurpose: "顾问审核时应把公开宣传与项目内部数据对齐，优先核验推广账号、招商合同、代理流水、终端成交、售后客诉和认证材料，避免把宣传热度误判为确定性需求。",
    };
  }

  const modules = uniqueModules(evidence).join("、") || "当前业务";
  return {
    problem: `本证据包重点回答：${modules}相关公开信息能否支撑诊断判断，并识别哪些结论仍需要项目内部数据复核。`,
    conclusion: insights.length
      ? `当前已形成 ${insights.length} 个可审核判断点，公开证据可以支撑方向判断，但不足以单独替代经营数据和顾问复核。`
      : "当前公开证据质量有限，只能证明存在相关信息，暂不能形成稳定经营判断。",
    auditPurpose: "顾问审核时应检查来源相关性、时效性、数据口径和结论跳跃，必要时要求补充账号后台、合同、流水、客户反馈或原始文件。",
  };
}

function summarizeGenericSources(items: ResearchEvidenceOut[]) {
  const snippets = items
    .map((item) => conciseSnippet(item.snippet))
    .filter(Boolean);
  if (snippets.length === 0) {
    return "当前外部证据只能证明存在相关公开信息，仍需结合项目内部数据进行复核。";
  }
  return ensurePeriod(Array.from(new Set(snippets)).slice(0, 2).join("；"));
}

function conciseSnippet(value: string) {
  const text = cleanDisplayText(value, "")
    .replace(/[#*_｜|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const sentences = text
    .split(/[。！？!?；;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length <= 90)
    .filter((item) => !/公开事项名称|实施意见|依据.+法律法规|为进一步深化|习近平新时代|党中央|国务院/.test(item));
  const selected = sentences.find((item) => /招商|加盟|渠道|代理|回本|认证|安全|竞品|评价|投诉|销量|动销/.test(item))
    ?? sentences[0]
    ?? text.slice(0, 88);
  return selected.length > 96 ? `${selected.slice(0, 96)}...` : selected;
}

function buildRiskText(module: string, statement: string) {
  if (/招商|加盟|合同|资质|回本|政策|合规|风险/.test(statement) || module.includes("compliance")) {
    return "涉及公开承诺、资质或政策边界，进入交付前需要核验原始页面、合同条款和项目实际履约数据。";
  }
  if (/投诉|评价|舆情|安全|召回|负面/.test(statement)) {
    return "公开评价或舆情只能说明市场信号，不能替代项目真实客诉、售后和质量数据。";
  }
  if (/竞品|市场|渠道|投放|流量|获客/.test(statement) || module === "market" || module === "sales") {
    return "公开市场信息可支撑方向判断，但还需要项目渠道消耗、线索质量和转化数据完成定量校准。";
  }
  return "该判断来自公开来源融合分析，需要结合项目内部经营数据和顾问复核后再进入最终交付。";
}

function buildDataGapText(evidence: ResearchEvidenceOut[]) {
  const text = evidence.map((item) => `${item.query} ${item.snippet}`).join(" ");
  if (/招商|加盟|回本|合同|资质|政策/.test(text)) {
    return "招商页、政策资质、合同条款、投放素材、渠道消耗和线索转化数据。";
  }
  if (/投放|获客|线索|转化|渠道/.test(text)) {
    return "推广账号后台、渠道消耗、线索来源、有效线索率和成交转化数据。";
  }
  if (/投诉|评价|售后|安全/.test(text)) {
    return "真实客诉记录、售后工单、质量检测材料和近 30 到 90 天用户反馈。";
  }
  return "项目内部经营数据、原始文件、账号后台截图或可审计导出表。";
}

function ensurePeriod(value: string) {
  const text = value.trim();
  if (!text) return text;
  return /[。！？.!?]$/.test(text) ? text : `${text}。`;
}

function uniqueModules(evidence: ResearchEvidenceOut[]) {
  return Array.from(new Set(evidence.map((item) => displayModuleLabel(item.module) || item.module).filter(Boolean))).slice(0, 4);
}
