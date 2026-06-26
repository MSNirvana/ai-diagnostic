import { useState } from "react";
import type { DomainTransformation } from "../../types";
import { cleanDisplayText, cleanSentenceText } from "../../utils/displayText";
import "./ProjectTransformationPage.css";

/**
 * 一个诊断问题(域)的 AI 改造详情——结果层(对比表)默认显示,实现层(30天分周)折叠。
 * 内嵌在作战室问题卡的「07 · 这个问题的 AI 改造」里,与该问题一一对应。
 */
export function TransformationDetail({ item }: { item: DomainTransformation }) {
  const [open, setOpen] = useState(false);
  const canExpand = item.stages.length > 0 || Boolean(item.prereq_risk);

  return (
    <article className="transform-theme transform-theme--embedded">
      <div className="transform-theme__result">
        {item.redesign_headline && (
          <div className="transform-theme__head">
            <div>
              <h3>{cleanDisplayText(item.redesign_headline, "用 AI 把这个环节重做一遍")}</h3>
            </div>
          </div>
        )}

        {item.before_after.length > 0 && (
          <section className="transform-theme__panel" aria-label="怎么改">
            <div className="transform-theme__section-head">
              <span>怎么改</span>
              <strong>把当前做法重做成 AI 原生打法</strong>
            </div>
            <div className="transform-ba">
              <div className="transform-ba__col-head transform-ba__col-head--before">现在</div>
              <div className="transform-ba__col-head transform-ba__col-head--after">AI 改造后</div>
              {item.before_after.map((row, i) => (
                <div className="transform-ba__row" key={`${row.dimension}-${i}`}>
                  <div className="transform-ba__dim">{cleanDisplayText(row.dimension, "")}</div>
                  <div className="transform-ba__before">{cleanSentenceText(row.before, "")}</div>
                  <div className="transform-ba__after">{cleanSentenceText(row.after, "")}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {item.investment && (
          <div className="transform-theme__investment">
            <span>投入</span>
            <strong>{cleanSentenceText(item.investment, "")}</strong>
          </div>
        )}

        {canExpand && (
          <section className="transform-theme__panel transform-theme__panel--implementation" aria-label="怎么做">
            <div className="transform-theme__section-head">
              <span>怎么做</span>
              <strong>30 天实施路径与分工</strong>
            </div>
            <button
              type="button"
              className="transform-theme__toggle"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              {open ? "收起怎么做 ▴" : "展开怎么做：看 30 天怎么搭起来 ▾"}
            </button>
          </section>
        )}
      </div>

      {open && canExpand && (
        <div className="transform-theme__impl">
          <div className="transform-stages">
            {item.stages.map((stage, i) => (
              <section className="transform-stage" key={`${stage.window}-${i}`}>
                <div className="transform-stage__window">{cleanDisplayText(stage.window, "阶段")}</div>
                <div className="transform-stage__body">
                  {stage.result && (
                    <p className="transform-stage__result"><b>阶段结果</b>{cleanSentenceText(stage.result, "")}</p>
                  )}
                  {stage.how && (
                    <p className="transform-stage__how"><b>系统怎么搭</b>{cleanSentenceText(stage.how, "")}</p>
                  )}
                  <div className="transform-stage__who">
                    {stage.ai_does && <div><span>AI 干</span><p>{cleanSentenceText(stage.ai_does, "")}</p></div>}
                    {stage.you_do && <div><span>你干</span><p>{cleanSentenceText(stage.you_do, "")}</p></div>}
                  </div>
                  {stage.ai_capabilities && stage.ai_capabilities.length > 0 && (
                    <div className="transform-stage__caps">
                      {stage.ai_capabilities.map((cap) => (
                        <span key={cap}>{cleanDisplayText(cap, "")}</span>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
          {item.prereq_risk && (
            <div className="transform-theme__footnotes">
              <p className="transform-theme__risk"><b>前提/风险</b>{cleanSentenceText(item.prereq_risk, "")}</p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
