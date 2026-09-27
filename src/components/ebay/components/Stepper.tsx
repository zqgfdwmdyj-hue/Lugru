import { CheckIcon } from './icons';

/** Die vier Schritte des Workflows — Reihenfolge ist die Anzeigereihenfolge. */
export const STEPS = ['Suchen', 'Auswählen', 'Daten', 'Vorschau'] as const;
export type Step = (typeof STEPS)[number];

export function Stepper({ current }: { current: Step }) {
  const index = STEPS.indexOf(current);
  return (
    <ol className="steps">
      {STEPS.map((name, i) => (
        <li key={name} className={i < index ? 'done' : i === index ? 'current' : ''}>
          <span className="step-dot">{i < index ? <CheckIcon size={13} /> : i + 1}</span>
          <span className="step-name">{name}</span>
        </li>
      ))}
    </ol>
  );
}
