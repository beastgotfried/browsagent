# THE PIPELINE IN 3 PHASES

The pipeline has three phases.

1. **PREPARE** — the build makes the source map and the index.
2. **LOCATE** — the user makes a mark. The tool finds the exact record.
3. **REPAIR** — an agent makes the repair. The tool runs the checks.

Each phase has one actor and one output. The output of one phase is the input
of the next phase.

---

## PHASE 1: PREPARE

**Actor:** the context pass, the build plugin, and the companion.
**Trigger:** the user asks for the context. Then each development server start
makes the stamp.
**Output:** the project context, then the index.

### Part A: the project context

The code lives in `@browsagent/context`.

1. `readSample` in `packages/context/src/sample.ts` reads a sample of the
   project: the tree, the manifests, the config files, the entry points, the
   route files, and the API calls. The sample skips `node_modules`, `dist`,
   `.output`, `.git`, `.wxt`, and `.browsagent`.
2. `makeContext` in `packages/context/src/make.ts` sends the sample to the
   cheap model. The call holds one system message and one user message.
3. `writeContext` in `packages/context/src/store.ts` writes
   `<project>/.browsagent/context.md` and
   `<project>/.browsagent/context.json`. The record holds the commit, the
   model, the token count, and the time.
4. The companion reads the saved context at start. `readContext` reads the two
   files. `isStale` compares the recorded commit to `HEAD`.
5. `ModelAgent.start` in `packages/agent-runner/src/agent.ts` puts the
   document into every later model call as the second system message.

The companion makes no context at start. The user presses **Make the context
again** in the side panel. The panel sends `{ kind: 'recontext' }`. The
companion calls the `onContext` hook in `packages/cli/src/index.ts`, and the
hook calls `makeContext`.

A stale context does not block a repair. The panel shows the stale mark.

### Part B: the index

1. `stampPlugin` in `packages/vite-plugin/src/index.ts` reads each `.jsx` and
   `.tsx` file.
2. `jsxStamp` in `packages/vite-plugin/src/jsx-stamp.ts` adds `data-src` and
   `data-component` to each element. It keeps the expression text of each
   dynamic property in `data-src-expr`.
3. The plugin adds a script tag with the path `/@browsagent/client.js` to the
   page.
4. `readStamp` and `readRecord` in `packages/client/src/register.ts` read one
   node. The content script uses both at the mark.
5. `collectStamps`, `collectRecords`, and the `{ kind: 'register' }` message
   are the whole-page path. No code serves the client script path, and no code
   sends `register` today. The mark path does not need them: the mark carries
   its own element.
6. `Index` in `packages/index-service/src/store.ts` stores a `register`
   message when one arrives.

### The context holds

- what the project is: the framework, the bundler, the package manager, the
  start command,
- the frontend: the routes, the entry points, the component roots, the styling
  system,
- the backend: the base URL, the endpoints, the shape of the request and the
  answer, the auth,
- the invariants: what must not break, and the file that proves it,
- the map: the 10 files that an agent most often needs.

### The index holds

- the source position of each node,
- the expression text,
- the component boundary,
- the instance identity,
- the parent position.

### Failure points

- The plugin has no `apply: 'serve'` gate. The stamp also goes into the
  production build. Read finding 9 in `docs/REVIEW.md`.
- The plugin reads only `.jsx` and `.tsx` files. A `.js` or `.ts` module gets
  no stamp. Read finding 8.
- A component root inside a fragment, or a component in `memo` or
  `forwardRef`, gets no `data-component`. Read finding 7.
- The node comes from `node_modules`. Then `editable: false`.
- The page loads no client script. Then no `register` message exists. The
  mark still works.

---

## PHASE 2: LOCATE

**Actor:** the user and the tool.
**Trigger:** the user turns on mark mode and clicks an element.
**Output:** one task record with full context.

### Steps

1. `Overlay` in `packages/client/src/overlay.ts` finds the element below the
   pointer. The content script calls `select` in
   `packages/extension/entrypoints/content.ts`.
2. `select` reads the static stamp with `readStamp` and the live value with
   `readRecord`. Both functions live in `packages/client/src/register.ts`.
3. The node can hold no stamp. Example: a node from a third-party script. Then
   `select` asks the MAIN-world bridge in
   `packages/extension/entrypoints/bridge.content.ts` for the React source.
4. The content script sends `{ kind: 'selected', selection }` to the worker.
5. The worker sends `{ kind: 'mark', selection, problem: null }` in
   `packages/extension/entrypoints/background.ts`. The companion answers with
   the record.
6. The side panel shows the record and the problem form. The user picks the
   kind and writes the problem. The panel sends
   `{ kind: 'send-mark', selection, problem }` to the worker.
7. The worker sends the mark with the problem.
   `IndexService.acceptMark` in `packages/index-service/src/index.ts` calls
   `recordFrom`. `recordFrom` joins the stamp and the live record into one
   `ElementRecord`.
8. `recordFrom` asks the `styles` and the `useSites` callbacks for the style
   rules and the use sites. The CLI sets neither callback, so a live record
   holds `styles: []` and `useSites: []`. The confidence value is `low` when
   the live record or the source file is absent, `high` when the style
   callback gives rules, and `medium` in the other cases.
9. `makeTask` makes the structured task. `Task.route` holds the address of the
   page at the time of the mark. The source file stays in `Task.record.src`.
   `TaskStore.put` stores it. The companion sends `{ kind: 'task' }` to every
   client.
10. `GET /tasks` returns every task.

### The record holds

- the source position and the expression,
- the evaluated result,
- the winning style rule and the losing rules,
- the parent chain,
- the use sites,
- the address of the page at the time of the mark,
- the state at the time of the mark,
- the confidence value.

### Failure points

- The node has no stamp, and the bridge finds no source. Then the content
  script sends `{ kind: 'error', message: 'This element has no source stamp.' }`.
- The node is `editable: false`. The record says so. The tool does not block
  the mark.
- Two use sites are possible. The record holds all of them. The tool does not
  ask the user.

---

## PHASE 3: REPAIR

**Actor:** one agent and the companion.
**Trigger:** the task enters the store.
**Output:** a repair with a diff and a check result.

### Steps

1. `IndexService.acceptMark` puts the task in the store and gives it to the
   `onTask` hook in `packages/cli/src/index.ts`.
2. `onTask` calls `AgentRunner.run` in `packages/agent-runner/src/index.ts`.
3. `AgentRunner.makeWorktree` makes one worktree for the task. The tree uses
   the commit of the mark. The runner uses `HEAD` when the task holds no
   commit. The worktree lives in
   `<project>/.browsagent/worktrees/<first 8 characters of the task id>`. A
   failed `git worktree add` stops the task with the words of git. The runner
   then runs the prepare command of the project in the worktree. The CLI sets
   `pnpm install --frozen-lockfile --prefer-offline`, because a fresh worktree
   holds no `node_modules`.
4. `ModelAgent.plan` in `packages/agent-runner/src/agent.ts` asks the model
   for a short plan and the files. This call holds no tools.
5. `ModelAgent.edit` runs the tool loop. The agent reads and writes files in
   the worktree with the three tools in
   `packages/agent-runner/src/tools.ts`. Read `docs/AGENT.md`.
6. `AgentRunner.checkCode` runs the type check. It runs the lint only when a
   lint command is set. The type check is required: the constructor of
   `AgentRunner` throws when the command is empty. The check command of the CLI
   runs the build first, because a fresh worktree holds no build output and a
   workspace package without its `dist` has no types for its importers.
7. The loop runs the edit again while a gate that ran failed or the diff is
   empty, and the try count is under `maxTries`. The CLI sets 3 tries.
   `Task.tries` counts the tries. A transient provider fault on the edit gets
   one more try in the same way: the code `provider` covers a network fault,
   a timeout, an HTTP 5xx, and a bad answer. A later try can then pass the
   check, and the task can end `done`. A permanent provider fault, such as a
   refused key, stops the task at once.
8. `AgentRunner.run` measures the diff of the worktree with `worktreeDiff`
   after each edit. The words of the agent are a summary, not the diff. The
   measurement records an intent to add for every untracked path first, so a
   new file appears in the diff. The runner returns the plan, the state, the
   evidence, and the measured diff. A failed git command stops the task: an
   empty answer is not a measurement.
9. `onTask` measures the diff a second time with `worktreeDiff` in
   `packages/agent-runner/src/accept.ts`. The two measurements must agree. A
   difference fails the task, because the diff is the only evidence that the
   repair is correct. On the normal path it writes the state, the plan, the
   files, the measured diff, and the evidence into the task.
10. The companion stores the changed task and sends it to every client. The
    side panel shows the state, the check result, the diff, and the **Accept
    the repair** button. A `done` task keeps its worktree. A `failed` or
    `unchecked` task loses it, because the accept step does not need it.
11. The user accepts. The panel sends `{ kind: 'accept', taskId }`. The
    companion refuses a task that a repair still uses, such as a `queued`
    task. The companion calls the `onAccept` hook. `acceptDiff` in
    `packages/agent-runner/src/accept.ts` applies the patch to the working tree
    with `git apply --check` and then `git apply`. The patch is the measured
    diff that the task holds, so the accept works after the worktree is gone.
    `onAccept` removes the worktree after an applied patch. A refused patch
    keeps the worktree, so the user can try again. The tool makes no commit
    and no branch.

The task holds the plan and the files. The side panel does not show the plan.
There is no agreement step.

Several repairs can run at the same time. Each task gets one worktree.

### The prompt for each agent

```
system   the fixed instructions for the project
system   the project context
user     the task: the record and the problem
```

The second message is absent when the companion holds no context.
`ModelAgent.start` builds the messages. The plan call adds one question to the
user message.

### Failure points

- The type check fails. Then the agent tries again. The runner stops the task
  after `maxTries` tries (3 in the CLI).
- A transient provider fault on the edit gets one more try while a try
  remains. The task can then end `done`. A permanent provider fault, such as
  a refused key, and every other fault stop the repair: the state is `failed`.
  `AgentRunner.run` catches a fault from the agent edit and keeps the measured
  diff. `onTask` catches a fault that escapes the runner, removes the
  worktree, and writes an empty diff. A `done` task keeps its worktree until
  the accept step. A `failed` or `unchecked` task loses its worktree at once.
- The type check command does not start. Then no gate ran, and the state is
  `unchecked`. The evidence reports `typecheckOk: null`. It never claims a
  failed check that never ran.
- Two agents change the same file. Each worktree is separate. The second
  accept fails at `git apply --check`, because the working tree moved. That
  refusal keeps the worktree of the task, so the user can try again.
- The project has no lint. Then the lint does not run. The evidence reports
  `lintOk: null`. The tool does not report a pass for a gate that did not run.
- The context is stale. Then the panel shows the stale mark. The repair still
  runs: the context is a guard, not a gate.

### What the check is

The check is the type check and the lint. The type check is required. The lint
is optional, because a project can have no lint. A gate that did not run
reports null. It never reports a pass.

The state names the result: `done` when the agent made an edit, the diff is
not empty, and every gate that ran passed. It is `failed` when a gate failed
after the last try, when the diff stayed empty, or when a fault ended the
loop. It is `unchecked` when no gate ran. Every failure names its reason in
`evidence.fault`, so the panel shows why the task stopped.

There is no screenshot step and no comparison at a screen width.

**A type check and a lint cannot tell a correct repair from a wrong one.** Both
pass for a wrong colour, a wrong width, and the right edit on the wrong
element. The diff is the only evidence that the repair is correct. The user
reads the diff.
