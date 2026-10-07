# ARCHITECTURE

## The rule

Do not attach a mark to a DOM element. Attach the mark to the source code.

The DOM tree and the source tree are different objects. Three maps connect them:

1. **Map A:** DOM node to component.
2. **Map B:** component to generated code position.
3. **Map C:** generated code position to source position.

Map A is private. Map B needs a development build. Map C is lossy. Therefore the
compiler must make the maps, not the agent.

## The stamp

The build plugin adds these attributes:

| Attribute | Data | Writer |
|---|---|---|
| `data-src` | `file:line:column` | `jsxStamp` in `packages/vite-plugin/src/jsx-stamp.ts` |
| `data-src-expr` | the expression text of each dynamic property | `jsxStamp` |
| `data-component` | the name of the component that made the element | `jsxStamp` |
| `data-inst` | the instance identity | `instanceId` in `packages/client/src/register.ts`, at read time |

The plugin writes `data-component` on the **root** element of each component
only. The finder walks up from the selected element to the nearest component
root. Therefore a repair lands on the component that owns the element, and not
on a child element inside it.

The plugin knows the original position. Therefore the pipeline does not need
source maps for the markup step.

The plugin reads only `.jsx` and `.tsx` files. It has no `apply: 'serve'` gate,
so the stamp also goes into the production build. A component root inside a
fragment, or a component in `memo` or `forwardRef`, gets no `data-component`.
Read findings 7, 8, and 9 in `docs/REVIEW.md`.

## The two sides of a record

A static map cannot know the result of `cn("px-4", big && "mt-2")`.
The runtime cannot know the expression. The tool joins the two sides:

| Side | Source | Data |
|---|---|---|
| Static | the compiler | the expression and the position |
| Runtime | the client | the evaluated value and the props |

`readStamp` and `readRecord` in `packages/client/src/register.ts` read the two
sides. The content script calls both at the mark.

## The project context

The record holds one element. It does not hold the shape of the project. An
agent that sees one element can break another element.

So PREPARE makes a second thing: **one small document about the project.** One
model call makes it. Every later model call gets it.

| Fact | Value |
|---|---|
| Maker | `makeContext` in `packages/context/src/make.ts` |
| Model calls | 1, on the cheap slot `modelCheap` |
| Size | under 1500 tokens |
| Life | until the user makes it again |
| Reader | every repair agent, read-only |

The document holds five parts: what the project is, the frontend, the
**backend APIs that the frontend calls**, the invariants, and a map of the 10
files an agent most often needs.

The invariants are the reason for the document. Example: "All API calls go
through `src/api/client.ts`. Do not call `fetch` in a component." Without that
line an agent can repair the element and break the backend contract.

`readSample` in `packages/context/src/sample.ts` reads the input.
`writeContext`, `readContext`, and `isStale` in
`packages/context/src/store.ts` write, read, and compare the two files under
`<project>/.browsagent/`. The companion makes no context at start. The user
presses **Make the context again** in the side panel.

Read `docs/CONTEXT.md` for the input, the output, and the budget.

## The prompt for an agent

Every model call holds three messages when the companion holds a context:

```
system   the fixed instructions for the project
system   the project context
user     the task: the record and the problem
```

`ModelAgent.start` in `packages/agent-runner/src/agent.ts` builds them. Read
`docs/AGENT.md` for the loop.

The first two messages are the same for every agent. **Only the third message is
different for each repair.** So the context costs its tokens one time, and not
one time for each agent.

## The model provider

The code lives in `@browsagent/model`.

| Value | Default | Held by |
|---|---|---|
| The API key | none | the companion |
| The API base | `https://openrouter.ai/api/v1` | the companion |
| The model | `~deepseek/deepseek-pro-latest` | the companion |
| The cheap model | `~deepseek/deepseek-v4-flash-latest` | the companion |

`loadProviderConfig` in `packages/model/src/config.ts` reads the four values in
this order. The first source that gives a value wins.

1. the environment,
2. `<project>/.browsagent/config.json`,
3. `~/.pi/agent/auth.json`, the pi provider store.

`ModelClient` in `packages/model/src/client.ts` sends the chat call. It reads
the provider body before it names a fault. A guardrail refusal is reported as
"blocked by guardrail" or "data policy". It is not reported as a network
fault.

**The key never goes to the browser.** The extension storage is readable by a
content script. The key is not needed in the page. The companion is a local
Node process, so it holds the key. `ProviderState` in `@browsagent/shared` has
no field for the key. Read `docs/CONTEXT.md`.

## The packages

| Package | Job | The files that carry it |
|---|---|---|
| `@browsagent/shared` | the types and the protocol | `src/types.ts`, `src/protocol.ts` |
| `@browsagent/vite-plugin` | the source stamp | `src/index.ts`, `src/jsx-stamp.ts` |
| `@browsagent/client` | the overlay and the read of one node | `src/overlay.ts`, `src/register.ts` |
| `@browsagent/style-resolver` | the style rules with the CDP | `src/index.ts` |
| `@browsagent/index-service` | the record join, the task store, and the routes | `src/index.ts`, `src/store.ts` |
| `@browsagent/agent-runner` | the worktree, the agent loop, the check, and the accept | `src/index.ts`, `src/agent.ts`, `src/tools.ts`, `src/accept.ts` |
| `@browsagent/model` | the provider: the key, the base, the models | `src/config.ts`, `src/client.ts` |
| `@browsagent/context` | the project context | `src/sample.ts`, `src/make.ts`, `src/store.ts` |
| `@browsagent/panel` | the task list markup and CSS. No package imports it today | `src/index.ts`, `src/styles.css` |
| `@browsagent/extension` | the side panel, the content script, and the worker | `entrypoints/` |
| `@browsagent/cli` | the companion start command and the hooks | `src/index.ts` |
| `demo-app` | the page under test | `examples/demo-app/src/` |

The extension package imports `@browsagent/client` and `@browsagent/shared`
only. The key stays out of the browser.

## The data flow

| # | Step | The file | The function or the message |
|---|---|---|---|
| 1 | The build adds the stamp. | `packages/vite-plugin/src/jsx-stamp.ts` | `jsxStamp` |
| 2 | The content script reads the marked node. | `packages/extension/entrypoints/content.ts` | `select`, `readStamp`, `readRecord` |
| 3 | The bridge answers when the node has no stamp. | `packages/extension/entrypoints/bridge.content.ts` | the probe answer |
| 4 | The worker sends the mark and keeps the queue. | `packages/extension/entrypoints/background.ts` | `{ kind: 'mark' }` |
| 5 | The companion joins the two sides of the mark. | `packages/index-service/src/index.ts` | `acceptMark`, `recordFrom` |
| 6 | The companion adds the style rules and the use sites. | `packages/style-resolver/src/index.ts` | `StyleResolver.resolve` (not wired by the CLI) |
| 7 | The companion makes and stores the task. | `packages/index-service/src/index.ts`, `src/store.ts` | `makeTask`, `TaskStore.put` |
| 8 | The user writes the problem. | `packages/extension/entrypoints/sidepanel/main.ts` | `sendMark` |
| 9 | The companion gives the task to the repair hook. | `packages/cli/src/index.ts` | `onTask` |
| 10 | The runner makes the worktree and runs the agent. | `packages/agent-runner/src/index.ts`, `src/agent.ts` | `AgentRunner.run`, `ModelAgent.plan`, `ModelAgent.edit` |
| 11 | The agent reads and writes the worktree. | `packages/agent-runner/src/tools.ts` | `TOOLS`, `callTool` |
| 12 | The model answers. | `packages/model/src/client.ts` | `ModelClient.chat` |
| 13 | The runner runs the type check and the lint. | `packages/agent-runner/src/index.ts` | `checkCode` |
| 14 | The CLI reads the diff and stores the changed task. | `packages/cli/src/index.ts` | `worktreeDiff`, the `onTask` return |
| 15 | The companion sends the changed task to every client. | `packages/index-service/src/index.ts` | `broadcast` |
| 16 | The side panel shows the diff and the Accept button. | `packages/extension/entrypoints/sidepanel/main.ts` | `card` |
| 17 | The user accepts. The tool applies the patch. | `packages/agent-runner/src/accept.ts` | `acceptDiff` |
| 18 | The context pass makes the document. | `packages/context/src/sample.ts`, `src/make.ts`, `src/store.ts` | `readSample`, `makeContext`, `writeContext` |
| 19 | The two HTTP routes answer. | `packages/index-service/src/index.ts` | `GET /tasks`, `GET /state` |

The runner makes one worktree for each task. The worktree uses the commit of
the mark. The runner runs the type check and the optional lint after each
agent edit. A gate that did not run reports null, and it never reports a pass.
Read `docs/PIPELINE.md`.

## The rule for the agent

`INSTRUCTIONS` in `packages/agent-runner/src/agent.ts` gives the agent its
rules:

1. Repair one element.
2. Make the smallest change.
3. Use the project context. Do not break an invariant.
4. Do not add a dependency.
5. Do not reformat a file that you did not need to change.
6. Read a file before you write it.
7. Use the tools. There is no shell tool.
8. Name the changed files and the reason.

The agent does not search the repo. The agent does not guess a file.

The project context is the guard. It names the invariants, so a repair does not
break the backend, the theme, or the route table.
