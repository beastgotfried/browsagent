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
3. The tool runs the type check and the lint.
4. The panel shows the diff. You agree or reject.

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

One model call makes it. Every repair agent gets it. Read `docs/CONTEXT.md`.

The agent runs through an API key that the user gives. The key, the API base,
and the model live in the companion, not in the browser.

## The packages

| Package | Job |
|---|---|
| `@browsagent/shared` | the types and the protocol |
| `@browsagent/vite-plugin` | Phase 1: add the source stamp |
| `@browsagent/client` | Phase 1 and 2: the register and the overlay |
| `@browsagent/index-service` | Phase 2: the index and the record |
| `@browsagent/style-resolver` | Phase 2: the style rules with the CDP |
| `@browsagent/agent-runner` | Phase 3: the worktree, the agent, the check |
| `@browsagent/model` | the provider: the key, the base, the model |
| `@browsagent/panel` | the management panel |
| `@browsagent/extension` | the browser extension |
| `@browsagent/cli` | the start command |

## Start

```bash
pnpm install
pnpm build
pnpm demo
```

Set the provider before the first repair:

```bash
export BROWSAGENT_API_KEY=...
export BROWSAGENT_API_BASE=https://openrouter.ai/api/v1
export BROWSAGENT_MODEL=...
```

## The documents

| Document | Holds |
|---|---|
| `docs/PIPELINE.md` | the three phases |
| `docs/ARCHITECTURE.md` | the maps, the stamp, the context, the provider |
| `docs/CONTEXT.md` | the project context and the model provider |
| `docs/DESIGN.md` | the decisions |
| `docs/REVIEW.md` | the defects that the review proved |
| `docs/WORKFLOW.md` | how work lands in this repository |

## Status

This repository holds the scaffold. The interfaces are complete. The bodies
are not complete.

**The scope is now the agent runtime only.** The style finder, the lane
decider, and the stamp adapters for other bundlers are dropped. Read
`docs/REVIEW.md`.
