import { cn } from '../cn.js';

interface RowProps {
  label: string;
  value: string;
  tone?: 'quiet' | 'warn';
}

/**
 * One line of a panel.
 *
 * The className is built at run time, so data-src-expr holds the expression
 * text and the live value holds the result. This file tests that join.
 */
export function Row({ label, value, tone = 'quiet' }: RowProps): JSX.Element {
  return (
    <div className="row">
      <span className={cn('pill', tone === 'warn' && 'pill--warn')}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
