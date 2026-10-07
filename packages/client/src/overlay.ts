import { STAMP } from '@browsagent/shared';

export interface OverlayCallbacks {
  onSelect: (node: Element) => void;
}

const HOST_ID = 'browsagent-overlay';

/**
 * The mark overlay.
 *
 * The overlay shows a box around the element below the pointer. A click sends
 * the element to the callback. The overlay uses a shadow root. Therefore the
 * styles of the page do not change the overlay.
 */
export class Overlay {
  private host: HTMLElement | null = null;
  private box: HTMLElement | null = null;
  private label: HTMLElement | null = null;
  private current: Element | null = null;
  private active = false;

  constructor(private readonly callbacks: OverlayCallbacks) {}

  get isActive(): boolean {
    return this.active;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.mount();
    window.addEventListener('mousemove', this.onMove, true);
    window.addEventListener('click', this.onClick, true);
    window.addEventListener('keydown', this.onKey, true);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('mousemove', this.onMove, true);
    window.removeEventListener('click', this.onClick, true);
    window.removeEventListener('keydown', this.onKey, true);
    this.unmount();
  }

  private mount(): void {
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      .box { position: fixed; border: 1px solid #4f8cff; background: rgba(79,140,255,0.12);
             pointer-events: none; transition: all 40ms linear; }
      .label { position: fixed; font: 11px/1.4 ui-monospace, monospace;
               background: #4f8cff; color: #fff; padding: 2px 6px; border-radius: 3px;
               pointer-events: none; white-space: nowrap; }
    `;

    const box = document.createElement('div');
    box.className = 'box';
    box.style.display = 'none';

    const label = document.createElement('div');
    label.className = 'label';
    label.style.display = 'none';

    shadow.append(style, box, label);
    document.documentElement.append(host);

    this.host = host;
    this.box = box;
    this.label = label;
  }

  private unmount(): void {
    this.host?.remove();
    this.host = null;
    this.box = null;
    this.label = null;
    this.current = null;
  }

  private readonly onMove = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.id === HOST_ID) return;
    this.highlight(target);
  };

  private readonly onClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const target = this.current;
    if (target) this.callbacks.onSelect(target);
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    // The toggle hotkey comes from the extension command. This handler only
    // closes the overlay.
    if (event.key === 'Escape') this.stop();
  };

  private highlight(node: Element): void {
    const box = this.box;
    const label = this.label;
    if (!box || !label) return;

    this.current = node;
    const rect = node.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    const position = node.getAttribute(STAMP.src) ?? 'no source stamp';
    label.textContent = `<${node.tagName.toLowerCase()}> ${position}`;
    label.style.display = 'block';
    label.style.left = `${rect.left}px`;
    label.style.top = `${Math.max(0, rect.top - 18)}px`;
  }
}
