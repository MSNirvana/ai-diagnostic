import type { BattleChainStep } from "../../types";

interface BattleChainPanelProps {
  chain: BattleChainStep[];
}

export function BattleChainPanel({ chain }: BattleChainPanelProps) {
  return (
    <section className="war-panel war-panel--chain">
      <div className="war-panel__heading">
        <span>Battle Chain</span>
        <h3>跨部门联动链</h3>
      </div>
      <ol className="battle-chain">
        {chain.map((step, index) => (
          <li className="battle-chain__step" key={step.id}>
            <span className="battle-chain__index">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{step.label}</strong>
              {step.note && <p>{step.note}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
