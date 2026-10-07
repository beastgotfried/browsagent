# browsagent

A bridge between an AI agent and a live web page.

## The problem

You design a page. One part looks wrong. You cannot point at that part and repair
only that part. You must write a new request for each part. The agent does not
know which file holds the part. The agent guesses. The repair is often wrong.

## The answer

Point at one element. Write the problem. The tool does the rest:

1. The tool finds the exact source position of the element.
2. One agent makes the smallest repair in a separate worktree.
3. The tool runs the type check. It runs the lint when the project has one.
4. The side panel shows the diff. You press **Accept the repair**, and the tool
   applies the patch with `git apply`. The tool makes no commit and no branch.

## The three phases

| Phase | Actor | Output |
|---|---|---|
| PREPARE | the context pass and the build plugin | the project context and the index |
| LOCATE | the user and the tool | the task record |
| REPAIR | the agent | a repair with a diff and a check result |

Read `docs/PIPELINE.md` for the full pipeline.

## Before the first repair

The tool makes one small document about the project: the framework, the
routes, **the backend APIs the frontend calls**, and the invariants that must
not break.

One model call makes it. Every repair agent gets it. Press **Make the context
again** in the side panel to make the document, and to make it again after a
large change. Read `docs/CONTEXT.md`.

The agent uses an API key that the user gives. The key, the API base, and the
model live in the companion, not in the browser.

## The packages

| Package | Job |
|---|---|
| `@browsagent/shared` | the types and the protocol |
| `@browsagent/vite-plugin` | the source stamp |
| `@browsagent/client` | the overlay and the read of one node |
| `@browsagent/index-service` | the record join, the task store, and the routes |
| `@browsagent/style-resolver` | the style rules with the CDP. The CLI does not wire it yet |
| `@browsagent/model` | the provider: the key, the base, the model |
| `@browsagent/context` | the project context: one model call makes it |
| `@browsagent/agent-runner` | the worktree, the agent loop, the check, and the accept |
| `@browsagent/panel` | the task list markup and CSS. No package imports it today |
| `@browsagent/extension` | the side panel, the content script, and the worker |
| `@browsagent/cli` | the companion start command |

## Start

Build the packages. Then start the companion and the page under test:

```bash
pnpm install
pnpm build          # build every package

pnpm dev            # the companion on port 4517
pnpm demo           # a second terminal: the page under test on port 4519
pnpm prove          # the end-to-end proof. Read "The end-to-end proof" below
```

Load the extension in the browser:

```
chrome://extensions -> Load unpacked -> packages/extension/.output/chrome-mv3
```

Set the provider before the first repair:

```bash
export BROWSAGENT_API_KEY=...
export BROWSAGENT_API_BASE=https://openrouter.ai/api/v1
export BROWSAGENT_MODEL=...
```

The companion also reads `<project>/.browsagent/config.json` and
`~/.pi/agent/auth.json`. Read `docs/CONTEXT.md`.

## The end-to-end proof

`pnpm prove` runs `scripts/prove-e2e.mjs`. The script starts the companion as
a child process, opens one websocket, sends one mark with a real problem,
waits for the repair, and accepts the patch. It prints PASS or FAIL for each
of its eight steps. No browser is needed.

The proof needs a built tree (`pnpm build`) and a provider key. It makes live
model calls: a plan call and one or more edit calls. The provider charges for
them.

The proof binds one local port for one run, so two proofs do not fight for
one port.

The accept step writes the patch into the working tree. The script records
the touched files before the accept, and puts them back when it ends, and on
SIGINT or SIGTERM. A SIGHUP or a SIGKILL can leave the patch in the tree. Run
`git status --short` after the proof.

## The documents

| Document | Holds |
|---|---|
| `docs/PIPELINE.md` | the three phases |
| `docs/ARCHITECTURE.md` | the packages, the maps, the stamp, the context, the provider |
| `docs/AGENT.md` | the agent loop, the three tools, and the three messages |
| `docs/CONTEXT.md` | the project context and the model provider |
| `docs/DESIGN.md` | the decisions |
| `docs/REVIEW.md` | the defects that the review proved |
| `docs/WORKFLOW.md` | how work lands in this repository |

## Status

The repair loop is complete. A mark makes a task. The agent writes a repair in
one worktree. The type check runs. **Accept** applies the patch with
`git apply`.

Two parts of the loop are open:

- The whole-page index has no sender. No code serves the client script path
  `/@browsagent/client.js`, and no code sends the `register` message. The mark
  still works, because the mark carries its own element.
- The companion does not wire the style finder. A live record holds no style
  rules.

Read `docs/REVIEW.md` for the open findings.
