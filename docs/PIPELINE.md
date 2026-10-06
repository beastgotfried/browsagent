# THE PIPELINE IN 3 PHASES

The pipeline has three phases.

1. **PREPARE** — the build makes the source map and the index.
2. **LOCATE** — the user makes a mark. The tool finds the exact record.
3. **REPAIR** — an agent makes the repair. The tool checks the pixels.

Each phase has one actor and one output. The output of one phase is the input
of the next phase.

---

## PHASE 1: PREPARE

**Actor:** the build plugin and the server.
**Trigger:** the user starts the development server.
**Output:** the index.

### Steps

1. The plugin reads each source file.
2. The plugin adds a stamp to each element. The stamp holds the source position.
3. The plugin keeps the expression text for each dynamic property.
4. The compiler makes the served code.
5. The client script loads in the page.
6. The client finds each rendered node with a stamp.
7. The client sends one record for each node to the server.
8. The server stores all records in the index.
9. The server marks each node as `editable: true` or `editable: false`.

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
- the screen width of the mark,
- the state at the time of the mark,
- the confidence value.

### Failure points

- The node has no stamp. Then the confidence value is low.
- The node is `editable: false`. Then the tool asks the user.
- Two use sites are possible. Then the tool asks the user.

---

## PHASE 3: REPAIR

**Actor:** one agent and the manager.
**Trigger:** the task enters the queue.
**Output:** a checked repair with before and after pictures.

### Steps

1. The manager makes one worktree for the task.
2. A second development server starts on its own port.
3. The agent gets the task record. The agent does not search the repo.
4. The agent reads only the named files.
5. The agent makes a short plan.
6. The panel shows the plan. The user can agree or change it.
7. The agent changes the smallest expression.
8. The type check and the lint run.
9. The second server renders the page.
10. The tool takes pictures at each screen width of the project.
11. The tool compares each picture with the before picture.
12. The tool checks the access data.
13. The panel shows the diff, the pictures, and the cost.
14. The user agrees or rejects the repair. The user can undo it with one click.

### Failure points

- The type check fails. Then the agent tries again. The manager stops the task
  after 3 tries.
- A picture gets worse. Then the task fails.
- Two agents change the same file. Then the merge step finds the conflict.
- The agent cannot check the result. Then the agent reports `unchecked`.
