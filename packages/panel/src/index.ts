import type { Task } from '@browsagent/shared';

/**
 * This file makes the HTML of one task list.
 *
 * The function holds no socket and no state. The extension side panel copies
 * this markup and `styles.css`. The caller sorts the tasks.
 */

/** One short label for the state. The badge shows the label. */
function stateLabel(state: Task['state']): string {
  if (state === 'waiting') return 'waiting for an answer';
  return state;
}

/**
 * Replace the HTML control characters in one value.
 *
 * The problem text comes from the user. The record values come from the page.
 * Both can hold `<`, `>`, `&`, or a quote.
 */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The rows of one card. The problem line sits above these rows. */
function detailRows(task: Task): string[] {
  const rows: string[] = [];

  if (task.record.component !== null) {
    rows.push(
      `<p class="card__row">component: <code>${escapeHtml(task.record.component)}</code></p>`,
    );
  }

  const expression = task.record.expressions['className'];
  // The record holds no value for this key when the element has no className.
  if (expression !== undefined) {
    rows.push(
      `<p class="card__row">expression: <code>${escapeHtml(expression)}</code></p>`,
    );
  }

  if (task.record.useSites.length > 0) {
    rows.push(`<p class="card__row">damage: ${task.record.useSites.length} use sites</p>`);
  }

  if (task.plan !== null) {
    rows.push(`<p class="card__row">plan: ${escapeHtml(task.plan)}</p>`);
  }

  if (task.evidence !== null) {
    const typecheck =
      task.evidence.typecheckOk === null ? 'not run' : String(task.evidence.typecheckOk);
    const lint = task.evidence.lintOk === null ? 'not run' : String(task.evidence.lintOk);
    rows.push(`<p class="card__row">typecheck: ${typecheck} | lint: ${lint}</p>`);
  }

  const diff = task.diff ?? '';
  if (diff.trim() !== '') {
    rows.push(`<pre class="card__diff">${escapeHtml(diff)}</pre>`);
  }

  return rows;
}

/** One card: the state, the source, the problem, the details, and the diff. */
function card(task: Task): string {
  const problemType = escapeHtml(task.problem.type);
  const problemText = escapeHtml(task.problem.text);

  return [
    '<li class="card">',
    '<div class="card__head">',
    `<span class="badge badge--${task.state}">${escapeHtml(stateLabel(task.state))}</span>`,
    `<span class="card__src">${escapeHtml(task.record.src.file)}:${task.record.src.line}</span>`,
    `<span class="card__confidence">confidence: ${escapeHtml(task.record.confidence)}</span>`,
    '</div>',
    `<p class="card__problem"><strong>${problemType}</strong>: ${problemText}</p>`,
    ...detailRows(task),
    '</li>',
  ].join('');
}

/**
 * Return the HTML of the task list.
 *
 * The function keeps the order of the array. The caller sorts the tasks. An
 * empty array gives an empty list.
 */
export function renderTasks(tasks: Task[]): string {
  return `<ul class="panel__list">${tasks.map(card).join('')}</ul>`;
}
