# The delivery workflow

This page tells you how work lands in this repository.

## The rule

**A change goes straight to `main`.** There is no work branch and no pull
request.

Every writer makes one commit and pushes it. The push is the delivery.

Never use force push. If a push is rejected, run `git pull --rebase origin main`
and push again.

## The shape

```
prep      one writer   switch to main, pull, prove the tree is clean
recon     parallel     read-only scouts
writers   SERIAL       one worker for each task, one commit and one push each
reviews   parallel     read-only reviewers
fix       one writer   repair the confirmed findings
verify    one scout    read-only check of the pushed range. It runs no proof
```

The writers are **serial**. One repository has one working tree. Two writers in
one tree overwrite each other. The read-only steps are parallel, because a read
does not change the tree. The verify step writes no tracked file. It does not
run `pnpm prove`. Read "The end-to-end proof".

## The gates

Both gates must pass before each commit:

```
pnpm -r typecheck
pnpm -r build
```

A gate failure stops the writer. The writer reports the failure and makes no
commit.

## The end-to-end proof

`pnpm prove` runs `scripts/prove-e2e.mjs`. The proof starts the companion as a
child process, opens one websocket, sends one mark, waits for the repair, and
accepts the patch. It prints PASS or FAIL for each of its eight steps.

The proof is not a gate. It needs a built tree and a provider key. It makes
live model calls. It binds one local port for one run. The accept step writes
the patch into the working tree, and the script puts the touched files back
when it ends, and on SIGINT or SIGTERM.

**The verify step does not run `pnpm prove`.** The verify step is read-only,
and the proof writes to the tree. A writing step may run the proof. To run the
proof beside a verify step, use a separate copy of the repository. Run
`git status --short` after the proof in every case.

## The task list

The runner is `scripts/browsagent-workflow.js`. Give it a topic, a recon list, a
task list, and a review list:

```js
subagent({
  workflow: "scripts/browsagent-workflow.js",
  async: true,
  cwd: "/Users/beastgotfried/project/browser-nav",
  model: "openrouter/~deepseek/deepseek-flash-latest:max",
  args: {
    topic: "the companion start command",
    recon: ["Find how the CLI starts the service. Name the files."],
    tasks: [
      { key: "start", brief: "Add one command that starts the companion and the demo." }
    ],
    reviews: [
      { key: "start", brief: "Check the start command. Look for a port clash." }
    ]
  }
})
```

The keys must be unique. The model suffix `:max` sets the thinking level.

## The rules for each child

The script gives every child the same rules:

- Work on `main`. Prove it with `git branch --show-current`.
- Stage your own files by name.
- Make one commit. Push it.
- Write the commit message in ASD-STE100 Simplified Technical English.
- Touch only the files that your task names.
- Stop if the tree holds a change that you did not make.
- Report the commit hash, the file list, the commands, and the result.
- Do not start another agent.

## The reason for the serial writer

A parallel writer needs its own worktree. A worktree needs a branch. A branch
needs a merge. That is the pull-request shape.

The direct shape is simpler. One tree, one writer at a time, one commit for each
task. The history stays linear.
