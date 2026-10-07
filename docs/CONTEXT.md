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

The companion reads the saved context at start. It makes no context at start.

The user presses **Make the context again** in the side panel, and the pass
runs one time. The panel sends `{ kind: 'recontext' }`. The companion then
calls `makeContext` and writes the two files.

A stale context does not block a repair. The panel shows the stale mark.

## The budget

| Limit | Value |
|---|---|
| Model calls for one pass | 1 |
| The answer | under 1500 tokens |
| The input | a sample of the project, not the whole repository |

The context must stay small. It goes into **every** later call. A large context
multiplies the cost of every repair.

## What goes in

`readSample` in `packages/context/src/sample.ts` reads the sample. It does not
read the whole repository.

| Input | Limit |
|---|---|
| The file tree | depth 3. It skips `node_modules`, `dist`, `.output`, `.git`, `.wxt`, and `.browsagent` |
| `package.json` | every file, workspace members included |
| The config files | `vite.config.*`, `next.config.*`, `tsconfig.json`, `tailwind.config.*`, `postcss.config.*` |
| The entry points | `src/main.*`, `src/App.*`, `app/page.*`, and `pages/index.*` |
| The route files | the first 10 files below a `routes`, `app`, or `pages` directory |
| The API calls | the lines that call `fetch(` or `axios`, or that hold `/api/`, in `packages/` and `examples/` |

The pass does not read the last context. It writes a new document from the
sample.

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

`context.json` holds the commit, the model, the token count, the time, and
the digest of the document. The digest pairs the two files: a reader refuses a
document from one pass and a record from another pass.

The token count is an estimate. The tool has no tokenizer. It counts one token
for every four characters of the document.

**Add `.browsagent/` to the ignore list of the project.** The document is
derived data. It is made from the tree.

## The staleness rule

The context names the commit it was made from. If `HEAD` has moved since then,
the context is **stale**.

The tool must say so. It must not use a stale context without a report.

**The context does not block a repair.** It is a guard, not a gate. A hard stop
would block a repair for a commit that has nothing to do with it.

The panel shows the state and one button:

```
context: stale (made at 8d1cdf4)     [ Make again ]
```

| The user does | The result |
|---|---|
| Nothing | the repair runs. The panel keeps the stale mark |
| Presses Make again | one model call. The context is new |

## The prompt shape

Every model call after the context pass has the same three messages:

```
system   the fixed instructions for the project
system   the project context
user     the task: the record and the problem
```

The second message is absent when the companion holds no context. The first
message never changes. The second message changes only when the context is
made again. **Only the third message is different for each repair.**

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

The user gives four values. All four are optional.

| Value | Default |
|---|---|
| The API key | none. Without a key no agent runs |
| The API base | `https://openrouter.ai/api/v1` |
| The model | `~deepseek/deepseek-pro-latest` |
| The cheap model | `~deepseek/deepseek-v4-flash-latest` |

The base and the model come from the user, so the tool is not fixed to one
provider.

### Two model slots

The context pass is a summary job. The repair is a coding job. **Do not spend
the strong model on the summary.**

| Slot | Model | Used by | Input | Output |
|---|---|---|---|---|
| `modelCheap` | `~deepseek/deepseek-v4-flash-latest` | the context pass | $0.018 / M | $1.28 / M |
| `model` | `~deepseek/deepseek-pro-latest` | every repair | $0.19 / M | $5.00 / M |

Both were tested against a live OpenRouter account:

- a plain answer: works,
- **a tool call: works,**
- **a tool result fed back, then a second answer: works,**
- JSON mode: works.

So an agent can read a file, read the answer, and continue. The agent loop needs
no framework.

### The guardrail block

On the tested account, **10 of 18 DeepSeek endpoints were refused** with
"blocked by guardrail" and "data policy". The refused set holds every older
DeepSeek chat model and `deepseek/deepseek-v4-pro`.

The usable set was:

```
~deepseek/deepseek-flash-latest
~deepseek/deepseek-v4-flash-latest
~deepseek/deepseek-pro-latest
deepseek/deepseek-v4-flash
deepseek/deepseek-v4-flash-0731
deepseek/deepseek-v4.1-flash
deepseek/deepseek-v4-pro-0813
```

**This is a setting on the account, not a fault in the tool.** The user can
change it at `openrouter.ai/settings/privacy`.

So the tool must report a refused model in clear words. It must not report a
network fault when the provider said "data policy".

### Where the key lives

**The key lives in the companion. It does not live in the browser.**

The extension storage is readable by a content script. The key is not needed in
the page. The companion is a local Node process, so it holds the key.

The companion reads the four values in this order. The first source that gives
a value wins.

| Order | Source |
|---|---|
| 1 | the environment |
| 2 | `<project>/.browsagent/config.json` |
| 3 | `~/.pi/agent/auth.json`, the pi provider store |

The third source is a convenience. A user of pi already keeps an OpenRouter key
there, so the tool needs no setup on that machine.

```
BROWSAGENT_API_KEY
BROWSAGENT_API_BASE
BROWSAGENT_MODEL
BROWSAGENT_MODEL_CHEAP
```

The environment wins over both files.

`.browsagent/` is in the ignore list of this project. Keep the project file
out of the repository.

### The report

The panel shows one of three states:

| State | Meaning |
|---|---|
| `no key` | No key is set. Repairs are off. |
| `key set` | A key is set. The panel shows the base and the model |
| `key bad` | The provider refused the key. The panel shows the words of the fault |

The panel never shows the key.

A refused call shows the words of the provider in the panel. A guardrail block
appears as a guardrail block. It never appears as a network fault. Read the
guardrail block above.

### The companion token

The extension makes a token and shows it on its options page. The companion
refuses a socket and an HTTP request that does not hold that token. Without the
check, any page or process on the machine can spend the key of the user and
apply a patch to the working tree.

The companion reads the token in this order:

1. the environment variable `BROWSAGENT_TOKEN`,
2. the `token` value in `<project>/.browsagent/config.json`.

The companion does not start without a token. It listens on `127.0.0.1` only.
