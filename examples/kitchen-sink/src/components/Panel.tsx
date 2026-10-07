import type { ReactNode } from 'react';

import { cn } from '../cn.js';

interface PanelProps {
  title: string;
  wide?: boolean;
  children: ReactNode;
}

/**
 * One block of content. The page uses this component several times.
 *
 * A repair inside this file changes EVERY panel on the page. A repair inside
 * App.tsx changes one call site. This is the reuse decision.
 */
export function Panel({ title, wide = false, children }: PanelProps): JSX.Element {
  return (
    <article className={cn('panel', wide && 'panel--wide')}>
      <h2 className="panel__title">{title}</h2>
      {children}
    </article>
  );
}
