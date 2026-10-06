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
3. The tool compares the pixels at each screen width.
4. The panel shows the result. You agree or reject.

## The three phases

| Phase | Actor | Output |
|---|---|---|
| PREPARE | the build plugin | the index |
| LOCATE | the user and the tool | the task record |
| REPAIR | the agent | a checked repair |

Read `docs/PIPELINE.md` for the full pipeline.

## The packages

| Package | Job |
|---|---|
| `@browsagent/shared` | the types and the protocol |
| `@browsagent/vite-plugin` | Phase 1: add the source stamp |
| `@browsagent/client` | Phase 1 and 2: the register and the overlay |
| `@browsagent/index-service` | Phase 2: the index and the record |
| `@browsagent/style-resolver` | Phase 2: the style rules with the CDP |
| `@browsagent/agent-runner` | Phase 3: the worktree, the agent, the check |
| `@browsagent/panel` | the management panel |
| `@browsagent/cli` | the start command |

## Start

```bash
pnpm install
pnpm build
pnpm demo
```

## Status

This repository holds the scaffold. The interfaces are complete. The bodies
are not complete.
