# THE PIPELINE IN 3 PHASES

The pipeline has three phases.

1. **PREPARE** — the build makes the source map and the index.
2. **LOCATE** — the user makes a mark. The tool finds the exact record.
3. **REPAIR** — an agent makes the repair. The tool runs the checks.

Each phase has one actor and one output. The output of one phase is the input
of the next phase.

---

## PHASE 1: PREPARE

**Actor:** the context pass, the build plugin, and the server.
**Trigger:** the project init, then each development server start.
**Output:** the project context, then the index.

### Part A: the project context

This part runs one time, at the project init. It runs again when the tree has
moved too far from the recorded commit. Read `docs/CONTEXT.md`.

1. The tool reads a sample of the project: the tree, the manifests, the config
   files, the entry points, the route files, and the API calls.
2. One model call makes the context. The answer is under 1500 tokens.
3. The tool writes `.browsagent/context.md`.
4. The tool records the commit and the token count in `.browsagent/context.json`.
5. Every later model call gets this context with the task.

### Part B: the index

1. The plugin reads each source file.

1. The plugin reads each source file.
2. The plugin adds a stamp to each element. The stamp holds the source position.
3. The plugin keeps the expression text for each dynamic property.
4. The compiler makes the served code.
5. The client script loads in the page.
6. The client finds each rendered node with a stamp.
7. The client sends one record for each node to the server.
8. The server stores all records in the index.
9. The server marks each node as `editable: true` or `editable: false`.

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

- The project has no plugin. Then no stamp exists.
- The node comes from `node_modules`. Then `editable: false`.
- HMR changes the module. Then the server refreshes the index.

---

## PHASE 2: LOCATE

**Actor:** the user and the tool.
**Trigger:** the user turns on mark mode and clicks an element.
**Output:** one task record with full context.

### Steps

1. The overlay finds the element below the pointer.
2. The client reads the stamp from that element.
3. The client reads the live value. Example: the final class list.
4. The client reads the current state. Example: hover or open.
5. The client asks the server for the style data.
6. The server gets the style data with the Chrome DevTools Protocol.
7. The server finds the winning rule and its source position.
8. The server finds all other use sites of the component.
9. The tool joins all data into one record.
10. The tool gives the record a confidence value.
11. The user writes the problem in the panel.
12. The tool makes a structured task.

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

- The node has no stamp. Then the confidence value is low.
- The node is `editable: false`. Then the tool asks the user.
- Two use sites are possible. Then the tool asks the user.

---

## PHASE 3: REPAIR

**Actor:** one or more agents and the manager.
**Trigger:** the task enters the queue.
**Output:** a repair with a diff and a check result.

### Steps

1. The manager makes one worktree for the task, at the commit of the mark. The
   manager uses `HEAD` when the task holds no commit.
2. The manager reads the project context. It reports a stale context.
3. The agent gets the project context and the task record.
4. The agent does not search the repository.
5. The agent makes a short plan.
6. The panel shows the plan. The user can agree or change it.
7. The agent changes the smallest expression.
8. The type check runs. The lint runs when the project has a lint command.
9. The panel shows the diff and the cost.
10. The user agrees or rejects the repair.

### The prompt for each agent

```
system   the fixed instructions for the project
system   the project context
user     the task: the record and the problem
```

Several agents can run at the same time. Each agent gets the same two system
messages and one different task.

### Failure points

- The type check fails. Then the agent tries again. The manager stops the task
  after 3 tries.
- Two agents change the same file. Then the merge step finds the conflict.
- The project has no lint. Then the lint does not run. The evidence reports
  `lintOk: null`. The tool does not report a pass for a gate that did not run.
- No gate can run. Then the agent reports the state `unchecked`.
- The context is stale. Then the tool asks the user. It does not use the context
  without a report.

### What the check is

The check is the type check and the lint. The type check is required. The lint
is optional, because a project can have no lint. A gate that did not run
reports null. It never reports a pass.

The state names the result: `done` when every gate that ran passed, `failed`
when a gate failed after the last try, and `unchecked` when no gate ran.

There is no screenshot step and no comparison at a screen width.

**A type check and a lint cannot tell a correct repair from a wrong one.** Both
pass for a wrong colour, a wrong width, and the right edit on the wrong
element. The diff is the only evidence that the repair is correct. The user
reads the diff.

Read `docs/REVIEW.md` for the finding.
