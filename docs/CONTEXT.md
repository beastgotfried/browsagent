# THE PROJECT CONTEXT

## The problem

An agent that sees one file breaks another file. The record holds the source
position and the values of one element. The record does not hold the shape of
the project. **So the agent must know that shape before it changes anything.**

The agent must not search the repository. A search costs tokens and gives a
different answer each time. One fixed document gives the same answer to every
agent.

## The rule

**One model call makes the context. Every later model call gets that same
context.**

The context does not change between repairs. So two agents that repair two
problems start from the same knowledge.

## When

At project init, before the first repair agent.

The context pass runs one time. The user can run it again by hand. The tool runs
it again when the tree has moved too far from the recorded commit.

## The budget

| Limit | Value |
|---|---|
| Model calls | 1 |
| The answer | under 1500 tokens |
| The input | a sample of the project, not the whole repository |

The context must stay small. It goes into **every** later call. A large context
multiplies the cost of every repair.

## What goes in

The context pass reads a sample. It does not read the whole repository.

| Input | Limit |
|---|---|
| The file tree | depth 3, no `node_modules`, no `dist` |
| `package.json` | every file, workspace members included |
| The config files | `vite.config.*`, `next.config.*`, `tsconfig.json`, the styling config |
| The entry points | 1 or 2 files |
| The route files | the first 10 |
| The API calls | the result of a search for `fetch(`, `axios`, and `/api/` |
| The existing context | the last version, when it exists |

## What comes out

One document with five parts. Each part has a hard limit.

| Part | Holds | Limit |
|---|---|---|
| What this project is | the framework, the bundler, the package manager, the language, the start command | 5 lines |
| The frontend | the routes, the entry points, the component roots, the styling system | 15 lines |
| The backend | the base URL, the endpoints the frontend calls, the shape of the request and the answer, the auth | 15 lines |
| The invariants | what must not break, and the file that proves it | 10 lines |
| The map | the 10 files that an agent most often needs | 10 lines |

The invariants are the point of the document. **They are the reason a repair
does not break the rest of the page.**

Examples of an invariant:

- All API calls go through `src/api/client.ts`. Do not call `fetch` in a
  component.
- The theme lives in `src/styles/tokens.css`. Do not write a colour value in a
  component.
- The route table is in `src/router.tsx`. Do not add a route in a page.

## The files

```
<project>/.browsagent/context.md     the document. A person can read it
<project>/.browsagent/context.json   the record of the pass
```

`context.json` holds the commit, the model, the token count, and the time.

**Add `.browsagent/` to the ignore list of the project.** The document is
derived data. It is made from the tree.

## The staleness rule

The context names the commit it was made from. If `HEAD` has moved since then,
the context is **stale**.

The tool must say so. It must not use a stale context without a report. Three
options for the user:

| Option | Result |
|---|---|
| Keep | use the context. The tool records the risk |
| Make again | one new model call |
| Stop | no repair runs |

## The prompt shape

Every model call after the context pass has the same three messages:

```
system   the fixed instructions for the project
system   the project context
user     the task: the record and the problem
```

The first message never changes. The second message changes only when the
context is made again. **Only the third message is different for each repair.**

So a repair costs the tokens of the context one time, not one time for each
agent.

## More than one agent

Several agents can run at the same time.

- Each agent gets the **same** context.
- Each agent gets **one** different problem.
- Each agent gets **one** worktree. Read D4 in `docs/DESIGN.md`.

The context is read-only. So no agent can change the knowledge of another
agent.

## The model provider

The user gives three values. All three are optional.

| Value | Default |
|---|---|
| The API key | none. Without a key no agent runs |
| The API base | `https://openrouter.ai/api/v1` |
| The model | a DeepSeek model on OpenRouter |

The base and the model come from the user, so the tool is not fixed to one
provider.

### Where the key lives

**The key lives in the companion. It does not live in the browser.**

The extension storage is readable by a content script. The key is not needed in
the page. The companion is a local Node process, so it holds the key.

```
~/.browsagent/config.json     the key, the base, and the model
```

A file in the home directory is better than a file in the project, because a
file in the project can reach the repository by accident.

The environment can also give the three values:

```
BROWSAGENT_API_KEY
BROWSAGENT_API_BASE
BROWSAGENT_MODEL
```

The environment wins over the file.

### The report

The panel shows one of three states:

| State | Meaning |
|---|---|
| `no key` | No key is set. Repairs are off. |
| `key set` | A key is set. The panel shows the base and the model |
| `key bad` | The provider gave an error. The panel shows the code |

The panel never shows the key.
