# The architecture review

Six reviewers read the code at `ed0e798`. One more reviewer read their findings
and kept only the ones that the code proves. This page holds the survivors.

**Every finding below has a file and a line. Each one is a real defect at
`ed0e798`.**

## The correction that matters

The review attacked claims about CSS Modules, SCSS, Tailwind, CSS-in-JS,
Next.js, Vue, and Preact.

**The falsifier dropped all of them.** Those systems are not in this repository
and no document claims them. The only framework anywhere is `docs/DESIGN.md:35`
— "React with Vite. (The first target.)"

So the lane table in the earlier plan was design for systems we do not use.
**The real defects are in the code we already have.**

## P0 — the design cannot work as written

### 1. The style seam has no address for the node

`packages/index-service/src/index.ts:26` declares the callback as
`styles?: (inst: string) => ...` and line 70 passes `stamp.inst`.

The only implementation is `packages/style-resolver/src/index.ts:87-97`, and it
feeds its argument to `DOM.querySelector`. `inst` is `i1`, `i2` from a counter
in `packages/client/src/register.ts:10-19`. **`i1` is a valid CSS type selector
that matches nothing.**

`packages/shared/src/types.ts:183-188` carries no selector, no `nodeId`, no
`frameId`, no `tabId`, and no load token. `tabUrl` is sent and never read
(`index-service/src/index.ts:68`).

### 2. The CDP source position is structurally unreachable

The lane decider needs the source position of the winning rule. It cannot get
one:

| Fact | Line |
|---|---|
| `toRule(entry, null)` — the source is null for every rule | `style-resolver/src/index.ts:105,109` |
| `file: ''` is the only write, and it sits in a dead branch | `style-resolver/src/index.ts:65` |
| `ruleSource` has zero callers | `style-resolver/src/index.ts:119` |
| `styleSheetId` is declared and never read | `style-resolver/src/index.ts:33` |
| `CdpSession` is send-only, so `CSS.styleSheetAdded` can never arrive | `style-resolver/src/index.ts:7-9` |

**The last line is the worst.** The stylesheet URL exists only in
`CSS.styleSheetAdded`. The transport cannot receive an event. So no future patch
to `toRule` can find the file.

## P1 — the output cannot answer the question

### 3. `winner: true` on every rule

`style-resolver/src/index.ts:71` sets `winner: true` for every rule, including
inherited ones at `:109-110`. `matchingSelectors` at `:36` is never read, so
`selector` can be a whole comma list.

This contradicts `packages/shared/src/types.ts:74-75`. **"The winning rule" does
not exist in the output.** That is the exact input the lane needs.

### 4. Inline styles are invisible

`MatchedStyles` at `style-resolver/src/index.ts:39-42` declares only
`matchedCSSRules` and `inherited`. CDP reports inline declarations in the
separate `inlineStyle` field. So an inline value that beats the author rule is
invisible, and the losing rule is reported as the winner.

`packages/client/src/register.ts:74` already records `values['style']`. Nothing
joins it to the cascade.

### 5. Confidence is a rule count, and `low` is unreachable

`index-service/src/index.ts:75-76` is the only producer:
`styles.length > 0 ? 'high' : 'medium'`.

It measures the count of matched rules, not the trust in the source position.
`packages/extension/entrypoints/sidepanel/main.ts:43` and
`docs/PIPELINE.md:82` say the opposite. `low` appears in the type and in the
docs, and in no code path.

### 6. The join is asymmetric

The compiler records every non-`data-` expression attribute
(`vite-plugin/src/jsx-stamp.ts:129-136`), so `key`, `onClick`, and `aria-label`
go in. The client reads only `class` and `style`
(`client/src/register.ts:69-75`). So `values` does not hold "the evaluated value
of each property" as `shared/src/types.ts:56-59` promises.

Spreads are skipped by the compiler, but the client still reads the resulting
`class` from the DOM. So a spread value is indistinguishable from a literal.

### 7. Component attribution breaks on common React idioms

`vite-plugin/src/jsx-stamp.ts:107` needs the element's parent to be a return
statement or an arrow body. Inside a fragment the parent is a `JSXFragment`, so
a fragment-rooted component gets no `data-component`.

`declaredName` at `:43-51` reads only `VariableDeclarator` and
`AssignmentExpression` parents, so `memo(() => ...)` and `forwardRef` get no
name.

`client/src/register.ts:65` then walks up with `closest('[data-component]')` and
attributes the element to an ancestor.

### 8. `.js` and `.ts` modules are silently skipped

`vite-plugin/src/index.ts:36` accepts only `/\.[jt]sx$/`. No warning, no stamp.

## P1 — the build leaks, and the records lie

### 9. The stamp ships to production

`vite-plugin/src/index.ts:32-58` has no `apply: 'serve'` gate.
`examples/demo-app/vite.config.ts:11` installs the plugin with no condition. So
the stamp and the client script compile into `vite build` output.

**This contradicts `docs/DESIGN.md` D6** — "The stamp exists in the development
build only. The production build is clean."

### 10. The runner asserts checks it never performs

`agent-runner/src/index.ts:110-117` returns `before: []`, `after: []`,
`accessOk: true`, and the literal `regression: false`.

`:84-91` returns `typecheckOk: true` and `lintOk: true` when the option is
absent, and both options are optional. So a misconfigured runner reports a green
check for code it never read.

`:103` and `:119` — `maxTries` is read and discarded with `void maxTries`. There
is no retry loop. `TaskState` has no `unchecked` member, although
`docs/PIPELINE.md:117` promises one.

`:125-127` declares `propagate` and `viewports`, read by nothing.

### 11. `?token=` is never checked

`extension/src/config.ts:11` says the companion checks the token on every
message. `index-service/src/index.ts:170-179` creates the server and
`handle` at `:131-152` never inspects a token.

## P2 — hygiene

### 12. A rejected resolve is silent

`index-service/src/index.ts:149-151` has no rejection handler. A closed tab
makes the CDP call reject, and the mark then produces no record, no task, and
not even the protocol's `{ kind: 'error' }`.

### 13. The worktree is `HEAD`, not the stamped tree

`agent-runner/src/index.ts:73` uses `git worktree add dir HEAD`.
`Task.commit` is written at `index-service/src/index.ts:101` and read nowhere.
The plugin has no mode gate, so the marked source can be an uncommitted HMR
state. **The agent then repairs a different file than the one the user sees.**

### 14. `inst` is not node identity

`client/src/register.ts:10-19` mints it from a per-page counter at read time.
It survives a React patch of `data-src`. A condition with two branches of the
same element type updates the host node, so **one `inst` can name two source
positions**. `shared/src/types.ts:45-46` calls it "the instance identity of the
rendered node".

### 15. Smaller items

| Item | Line |
|---|---|
| Two line bases, `+1` in one path and raw in the other | `style-resolver/src/index.ts:65` vs `:131` |
| `specificity` counts `::before` and `:where()` as classes | `style-resolver/src/index.ts:49-53` |
| `ARCHITECTURE.md:24` lists `data-inst` as a build stamp. Only `register.ts:18` writes it | `docs/ARCHITECTURE.md:24` |
| `types.ts:71` documents `origin: 'author'`. Raw CDP gives `'regular'` | `shared/src/types.ts:71` |
| `recordFrom` says "does not read the page again", false once wired | `index-service/src/index.ts:62-66` |
| `tabId` and `frameId` are dropped at the one place they exist | `extension/entrypoints/background.ts:217,233` |
| A queued mark holds no timestamp, project, or document identity | `extension/entrypoints/background.ts:68-75` |

## Two decisions that void the design document

### D5 — there is no picture check

There is no screenshot step by decision. **So the check has no carrier.**
Finding 10 is what remains: a type check and a lint, and both default to pass.
The desktop-to-mobile requirement has no carrier at all.

### D6 — "Development only" is not enforced

`docs/DESIGN.md` D6 says: "The stamp exists in the development build only. The
production build is clean."

`vite-plugin/src/index.ts` has `enforce: 'pre'` and no `apply: 'serve'`. The
`transformIndexHtml` hook at `:54-57` injects the client script with no
condition. **The stamp and the client both ship to production.** Finding 9.

## What survived from the claims

| Claim | Verdict |
|---|---|
| C1 — the framework ends at the build | Holds for React with Vite. The SWC and Turbopack trap is real for a future framework, not a defect today. |
| C2 — one CSSOM reader serves every styling system | The mechanism is right. The code cannot feed it (findings 1 to 4). |
| C3 — the lane needs no detector | The decider is fine. **Its inputs do not exist.** |
| C4 — the mark carries the whole selection | True, and it carries **no address**. The companion cannot act on it. |
| C5 — anchor on the source position, not a DOM selector | Holds. The `.map()` case is a stated trade-off at `docs/DESIGN.md:10-11`, not a defect. |
| C6 — the record joins two sides | Works for `className`. Asymmetric for everything else. |
| C7 — one writer for each tree | Holds. |
| C8 — the repair is checked | **False.** Type check and lint remain, and both default to pass. |
