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

The build plugin adds these attributes in the development build:

| Attribute | Data |
|---|---|
| `data-src` | `file:line:column` |
| `data-src-expr` | the expression text of each dynamic property |
| `data-inst` | the instance identity |
| `data-component` | the name of the component that made the element |

The plugin writes `data-component` on the **root** element of each component
only. The finder walks up from the selected element to the nearest component
root. Therefore a repair lands on the component that owns the element, and not
on a child element inside it.

The plugin knows the original position. Therefore the pipeline does not need
source maps for the markup step.

## The two sides of a record

A static map cannot know the result of `cn("px-4", big && "mt-2")`.
The runtime cannot know the expression. The tool joins the two sides:

| Side | Source | Data |
|---|---|---|
| Static | the compiler | the expression and the position |
| Runtime | the client | the evaluated value and the props |

## The project context

The record holds one element. It does not hold the shape of the project. An
agent that sees one element can break another element.

So PREPARE makes a second thing: **one small document about the project.** One
model call makes it. Every later model call gets it.

| Fact | Value |
|---|---|
| Model calls to make it | 1 |
| Size | under 1500 tokens |
| Life | until the tree moves from the recorded commit |
| Reader | every repair agent, read-only |

The document holds five parts: what the project is, the frontend, the
**backend APIs that the frontend calls**, the invariants, and a map of the 10
files an agent most often needs.

The invariants are the reason for the document. Example: "All API calls go
through `src/api/client.ts`. Do not call `fetch` in a component." Without that
line an agent can repair the element and break the backend contract.

Read `docs/CONTEXT.md` for the input, the output, and the budget.

## The prompt for an agent

Every model call after the context pass has three messages:

```
system   the fixed instructions for the project
system   the project context
user     the task: the record and the problem
```

The first two messages are the same for every agent. **Only the third message is
different for each repair.** So the context costs its tokens one time, and not
one time for each agent.

## The model provider

| Value | Default | Held by |
|---|---|---|
| The API key | none | the companion |
| The API base | `https://openrouter.ai/api/v1` | the companion |
| The model | a DeepSeek model | the companion |

The user gives all three. So the tool is not fixed to one provider.

**The key never goes to the browser.** The extension storage is readable by a
content script. The key is not needed in the page. The companion is a local
Node process, so it holds the key. Read `docs/CONTEXT.md`.

## The data flow

```
source files
    |
    v
[vite-plugin]  add the stamp
    |
    v
served code  ->  page  ->  [client]  register the live data
    |                        |
    |                        v
    |                   [index-service]  join and store
    |                        |
    |                        v
    |                   the record  <--  [style-resolver]  CDP
    |                        |
    |                        v
    |                   the user writes the problem
    |                        |
    v                        v
    |              [context pass]  one model call at init
    |                        |
    |                        v
    |               .browsagent/context.md
    |                        |
    v                        v
                 [agent-runner]  worktree, agent, check
                                 |
                                 v
                            [panel]  the result
```

## The rule for the agent

The agent does only five jobs.

1. Read the project context.
2. Read the record.
3. Pick the repair layer: local usage or shared component.
4. Make the smallest change in the correct expression.
5. Check the result.

The agent does not search the repo. The agent does not guess a file.

The project context is the guard. It names the invariants, so a repair does not
break the backend, the theme, or the route table.
