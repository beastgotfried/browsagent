import { memo } from 'react';

interface BadgeProps {
  count: number;
  title: string;
}

/**
 * A small count. The component is wrapped in memo().
 *
 * The stamp plugin must still place data-component on the root element.
 */
export const Badge = memo(function Badge({ count, title }: BadgeProps) {
  return <span className="badge" title={title}>{count}</span>;
});
