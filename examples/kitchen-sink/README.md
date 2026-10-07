# The kitchen sink

One page that uses every stamped path. Use it to test the tool to its limit.

```bash
pnpm --filter kitchen-sink dev
```

The page is on `http://localhost:4521`. The API is on `127.0.0.1:4522`.

## What each part tests

| Part | The path it tests |
|---|---|
| the header | a plain element with a static class |
| the toolbar | three sibling buttons, one with no visible text |
| the summary panel | a shared component, used five times on the page |
| the tags panel | `TAGS.map()` — **six elements from ONE source position** |
| the condition panel | two branches of one condition, the same element type |
| the fragment panel | a component whose root is a fragment |
| the note panel | `forwardRef()` and a controlled input |
| the orders table | data from a real backend call, `GET /api/orders` |
| `Badge` | `memo()` |
| `Row` | a class built at run time: `cn('pill', tone === 'warn' && 'pill--warn')` |

## What to try

Point at an element, then send a problem. Each line names the layer a correct
repair must reach.

| The problem to type | The correct layer |
|---|---|
| The panel padding is tight. Give it room. | `src/kitchen.css`, the `.panel` rule |
| The toolbar buttons must sit at the two ends. | `src/kitchen.css`, the `.toolbar` rule |
| The four columns overflow on a telephone. | `src/kitchen.css`, the `.grid` rule |
| The warning pill is hard to read. | `src/kitchen.css` or `src/tokens.css` |
| The summary total is wrong. | `src/App.tsx`, the `sum` call |
| The gear button has no name for a screen reader. | `src/App.tsx`, the toolbar |
| Do not show the details until the user asks. | `src/App.tsx`, the `open` state |
| Every panel must show a count, not only the first. | `src/components/Panel.tsx` — **a shared change** |
| The tags panel must show four items, not six. | `src/App.tsx`, the `TAGS` list |

The last item is `TAGS.map()`. **All six items carry the same source position.**
A repair to one item changes all six. Try it and see.

## The known gaps this page shows

The build output proves three gaps. Run this and read the counts:

```bash
pnpm --filter kitchen-sink build
grep -o 'data-component":"[A-Za-z]*"' examples/kitchen-sink/dist/assets/*.js | sort -u
```

| Component | `data-component` | Why |
|---|---|---|
| `App`, `Panel`, `Row` | **yes** | a plain function declaration |
| `Badge` | **no** | `memo(function Badge(...))` — the function sits inside a call |
| `Field` | **no** | `forwardRef(function Field(...))` — the same |
| `Frag` | **no** | the root is a fragment, so there is no element to stamp |

So a mark inside `Badge`, `Field`, or `Frag` reports `component: null`.

## The API

`server.mjs` answers `GET /api/orders`. The context pass must find this call.
The page shows the total of the three orders. **The sum is 155.**
