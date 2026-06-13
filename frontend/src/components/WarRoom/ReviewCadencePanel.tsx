import type { ReviewCheckpoint } from "../../types";

interface ReviewCadencePanelProps {
  checkpoints: ReviewCheckpoint[];
}

export function ReviewCadencePanel({ checkpoints }: ReviewCadencePanelProps) {
  return (
    <section className="war-panel">
      <div className="war-panel__heading">
        <span>Review Cadence</span>
        <h3>复盘追踪</h3>
      </div>
      <div className="checkpoint-list">
        {checkpoints.map((checkpoint) => (
          <article className="checkpoint-card" key={checkpoint.window}>
            <span>{checkpoint.window}</span>
            <h4>{checkpoint.title}</h4>
            <ul>
              {checkpoint.checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
