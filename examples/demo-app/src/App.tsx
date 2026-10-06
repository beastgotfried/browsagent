import { useState } from 'react';

import { cn } from './cn.js';

/**
 * A shared component. It has two use sites.
 * A repair here changes both use sites.
 */
export function Button(props: { children: string; big?: boolean }): JSX.Element {
  return (
    <button className={cn('btn', props.big === true && 'btn--big')}>
      {props.children}
    </button>
  );
}

export function Navbar(): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <nav className={cn('nav', open && 'nav--open')}>
      <span className="nav__brand">browsagent</span>
      <Button big>Sign up</Button>
      <button
        className="nav__burger"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        menu
      </button>
    </nav>
  );
}

export function Card(props: { title: string; text: string }): JSX.Element {
  return (
    <article className="card">
      <h2 className="card__title">{props.title}</h2>
      <p className="card__text">{props.text}</p>
      <Button>Read more</Button>
    </article>
  );
}

export function App(): JSX.Element {
  return (
    <main className="page">
      <Navbar />
      <Card title="First card" text="Point at me and write a problem." />
      <Card title="Second card" text="This card uses the same component." />
    </main>
  );
}
