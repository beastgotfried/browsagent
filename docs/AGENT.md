# THE AGENT LOOP

The agent repairs one element. The code lives in
`packages/agent-runner/src/agent.ts`.

The agent is a plain tool loop. There is no agent framework.

## The three messages

Every repair starts with three messages:

```
system   the fixed instructions
system   the project context
user     the task: the record and the problem
```

`ModelAgent.start` builds them.

1. **The fixed instructions.** `INSTRUCTIONS` in `agent.ts` is the same text
   for the plan call and the edit call. It holds the rules: make the smallest
   change, use the context, do not add a dependency, do not reformat a file,
   read a file before you write it, use the tools, and name the changed files.
2. **The project context.** The markdown of `ProjectContext`. The companion
   reads it from `<project>/.browsagent/context.md`. The agent gets it as the
   second system message. The message is absent when the companion holds no
   context.
3. **The task.** `taskText` writes the task id, the route, the record of the
   marked element, and the problem.

The plan call adds one question to the user message. The question asks for one
JSON object: `{"plan": "the short plan", "files": ["a/path.ts"]}`. `parsePlan`
reads the answer. It keeps the words of the answer when the answer is not
JSON.

## The two calls

1. **The plan.** `ModelAgent.plan` makes one call with no tools. It returns
   the short plan and the files. The task holds both. The side panel does not
   show the plan.
2. **The edit.** `ModelAgent.edit` runs the tool loop. It returns a summary
   of the change. The runner measures the diff itself.

## The tool loop

1. The loop sends the messages and the three tools.
2. The model answers with words, with tool calls, or with both.
3. The loop runs each tool call. It appends one tool message for each call.
   The tool message holds the identity of the call.
4. The loop stops when the answer holds no tool call. The words of the answer
   are the result.
5. The loop stops after 12 turns in every other case. It then reports a
   fault: the model did not stop, and its last tool result never reached it.
   `MAX_TURNS` in `agent.ts` is 12. The runner marks the task `failed` and
   keeps the measured diff.

One turn is one model call and its tool results. The cap stops a loop that
never ends. The cap keeps the cost of one repair small.

## The three tools

The tools live in `packages/agent-runner/src/tools.ts`. There are three, and
there is no fourth.

| Tool | Job |
|---|---|
| `list_files` | List the names in one directory. One level. It hides `node_modules` and `.git`. The limit is 200 names |
| `read_file` | Read one file with a line number on each line. The limit is 200 KB |
| `write_file` | Write the whole file. It makes a missing directory |

Every path is relative to the worktree root. Every path must stay inside the
root. The function `inside` refuses an absolute path, a path with a `..` part,
and a path that resolves outside the root. The function `safePath` then
resolves the real path. A symbolic link that leaves the worktree is refused,
and a dangling link is followed by its own text, because a write call would
create the target of that link. A missing parent directory is allowed:
`write_file` makes it. The path `.git` is refused in every case: a write there
destroys the worktree of the task.

A bad tool name and a bad argument give a text answer. The call does not
throw. The model reads the text and tries again.

## Why there is no shell tool

A shell can run any command. A command can leave the worktree, change the
repository, or start a server. **One shell tool is enough to break the rule
that one agent changes one worktree.** The three tools read and write files
inside the root. The path check is the guard.

The type check and the lint are not agent tools. `AgentRunner.checkCode` in
`packages/agent-runner/src/index.ts` runs them. The agent cannot skip a gate
and cannot claim a pass.

## The check and the retry

1. `checkCode` runs the type check. The type check is required: the
   constructor of `AgentRunner` throws when the command is empty.
2. `checkCode` runs the lint only when a lint command is set. A lint that did
   not run gives `lintOk: null`.
3. The runner runs the edit again while a gate that ran failed or the diff is
   empty, and the try count is under `maxTries`. The CLI sets 3 tries.
4. The state is `done` when the agent made an edit, the diff is not empty, and
   every gate that ran passed. The state is `failed` when a gate failed after
   the last try, when the diff stayed empty, or when the agent threw a fault.
   The state is `unchecked` when no gate ran.

## The diff

The diff is the measure of the repair. There is no picture check (D5).

**The tool measures the evidence. The agent does not report the evidence.**

`AgentRunner.run` reads `git diff` in the worktree with `worktreeDiff` in
`packages/agent-runner/src/accept.ts`, after each edit. The words of
`ModelAgent.edit` are a summary, not the diff. The measurement records an
intent to add for every untracked path first, so a new file appears in the
diff. The CLI measures the diff a second time and compares the two values. A
difference fails the task: the diff is the only evidence of the repair. The
user reads the diff in the side panel.

## The accept

The agent never lands a commit (D9). The user presses **Accept the repair**.
A `done` task keeps its worktree until this step. `onTask` removes the
worktree of a `failed` or `unchecked` task: the accept step does not need it.
The CLI also removes the worktree when a fault escapes the runner. Example:
the worktree call fails, or the plan call fails. The panel sends
`{ kind: 'accept', taskId }`. The accept step uses the measured diff that the
task holds, so it works after the worktree is gone. `acceptDiff` applies the
patch to the working tree with `git apply --check` and then `git apply`. The
tool makes no commit and no branch. A refused patch keeps the worktree: the
user can try again after the working tree moves.
