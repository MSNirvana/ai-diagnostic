interface StepIndicatorProps {
  steps: { label: string }[];
  current: number;
  filled: boolean[];
}

export function StepIndicator({ steps, current, filled }: StepIndicatorProps) {
  return (
    <nav className="step-indicator" aria-label="问卷进度">
      {steps.map((step, i) => {
        const isCurrent = i === current;
        const isFilled = filled[i] && !isCurrent;
        const nodeClass = isCurrent
          ? "step-node step-node--current"
          : isFilled
            ? "step-node step-node--filled"
            : "step-node";
        const labelClass = isCurrent
          ? "step-label step-label--current"
          : "step-label";
        return (
          <div className="step-item" key={i}>
            {i > 0 && <span className="step-line" aria-hidden="true" />}
            <div className="step-cell">
              <span className={nodeClass} aria-current={isCurrent ? "step" : undefined}>
                {isFilled ? "✓" : i + 1}
              </span>
              <span className={labelClass}>{step.label}</span>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
