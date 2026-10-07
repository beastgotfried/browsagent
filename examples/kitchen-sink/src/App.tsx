import { useEffect, useState } from 'react';

import { Badge } from './components/Badge.js';
import { Field } from './components/Field.js';
import { Frag } from './components/Frag.js';
import { Panel } from './components/Panel.js';
import { Row } from './components/Row.js';
import { cn } from './cn.js';

interface Order {
  id: string;
  customer: string;
  total: number;
}

/** One item of the list. Every item comes from ONE source position. */
const TAGS = ['draft', 'paid', 'packed', 'sent', 'done', 'void'];

export function App(): JSX.Element {
  const [orders, setOrders] = useState<Order[]>([]);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void fetch('/api/orders')
      .then((answer) => answer.json())
      .then((body: { orders: Order[] }) => setOrders(body.orders))
      .catch(() => undefined);
  }, []);

  const sum = orders.reduce((total, order) => total + order.total, 0);

  return (
    <main className="page">
      <header className="head">
        <h1 className="head__title">Orders</h1>
        <p className="head__note">The kitchen sink. Every stamped path is here.</p>
      </header>

      <div className="toolbar">
        <button type="button" className="btn btn--primary">Send the report</button>
        <button type="button" className="btn" aria-hidden="true">&#9881;</button>
        <span className={cn('pill', open && 'pill--on')}>{open ? 'open' : 'closed'}</span>
      </div>

      <div className="grid">
        <Panel title="Summary">
          <Row label="Orders" value={String(orders.length)} />
          <Row label="Total" value={String(sum)} tone="warn" />
          <div className="panel__foot">
            <Badge count={orders.length} title="the count of orders" />
          </div>
        </Panel>

        <Panel title="Tags">
          {TAGS.map((tag) => (
            <Row key={tag} label={tag} value={tag.toUpperCase()} />
          ))}
        </Panel>

        <Panel title="The condition">
          {open ? (
            <p className="panel__body">The details are open.</p>
          ) : (
            <p className="panel__body">The details are closed.</p>
          )}
          <div className="panel__foot">
            <button type="button" className="btn" onClick={() => setOpen(!open)}>
              Show the details
            </button>
          </div>
        </Panel>

        <Panel title="A fragment root">
          <Frag />
        </Panel>

        <Panel title="The note" wide>
          <Field label="Note" value={note} onChange={setNote} />
          <p className="panel__body">The note holds {note.length} characters.</p>
        </Panel>

        <Panel title="The orders" wide>
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.id}</td>
                  <td>{order.customer}</td>
                  <td>{order.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
      </Panel>
      </div>
    </main>
  );
}
