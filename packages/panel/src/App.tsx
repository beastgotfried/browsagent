import { useEffect, useState } from 'react';

import { DEFAULT_PORT, type ServerToClient, type Task } from '@browsagent/shared';

const STATE_ORDER: Record<Task['state'], number> = {
  working: 0,
  verifying: 1,
  waiting: 2,
  queued: 3,
  failed: 4,
  rejected: 5,
  done: 6,
  unchecked: 7,
};

function stateLabel(state: Task['state']): string {
  if (state === 'waiting') return 'waiting for an answer';
  return state;
}

export function App(): JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = new WebSocket(`ws://localhost:${DEFAULT_PORT}`);
    socket.addEventListener('open', () => setConnected(true));
    socket.addEventListener('close', () => setConnected(false));
    socket.addEventListener('message', (event) => {
      let message: ServerToClient;
      try {
        message = JSON.parse(String(event.data)) as ServerToClient;
      } catch {
        return;
      }
      if (message.kind !== 'task') return;
      const task = message.task;
      setTasks((old) => {
        const next = old.filter((item) => item.id !== task.id);
        next.push(task);
        return next.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
      });
    });
    return () => socket.close();
  }, []);

  return (
    <main className="panel">
      <header className="panel__head">
        <h1>browsagent</h1>
        <span className={connected ? 'dot dot--on' : 'dot dot--off'} />
        <span>{connected ? 'connected' : 'offline'}</span>
      </header>

      <p className="panel__count">{tasks.length} tasks</p>

      <ul className="panel__list">
        {tasks.map((task) => (
          <li key={task.id} className="card">
            <div className="card__head">
              <span className={`badge badge--${task.state}`}>{stateLabel(task.state)}</span>
              <span className="card__src">
                {task.record.src.file}:{task.record.src.line}
              </span>
              <span className="card__confidence">confidence: {task.record.confidence}</span>
            </div>

            <p className="card__problem">
              <strong>{task.problem.type}</strong>: {task.problem.text}
            </p>

            {task.record.component ? (
              <p className="card__row">
                component: <code>{task.record.component}</code>
              </p>
            ) : null}

            {task.record.expressions['className'] ? (
              <p className="card__row">
                expression: <code>{task.record.expressions['className']}</code>
              </p>
            ) : null}

            {task.record.useSites.length > 0 ? (
              <p className="card__row">damage: {task.record.useSites.length} use sites</p>
            ) : null}

            {task.plan ? <p className="card__row">plan: {task.plan}</p> : null}
            {task.evidence ? (
              <p className="card__row">
                typecheck: {String(task.evidence.typecheckOk)} | lint:{' '}
                {task.evidence.lintOk === null ? 'not run' : String(task.evidence.lintOk)}
                {' | '}diff: {task.evidence.diff === '' ? 'none' : 'present'}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
