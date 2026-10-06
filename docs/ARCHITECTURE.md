# ARCHITECTURE

## The rule

Do not attach a mark to a DOM element. Attach the mark to the source code.

The DOM tree and the source tree are different objects. Three maps connect them:

1. **Map A:** DOM node to component.
2. **Map B:** component to generated code position.
3. **Map C:** generated code position to source position.

Map A is private. Map B needs a development build. Map C is lossy. Therefore the
compiler must make the maps, not the agent.

## The stamp

The build plugin adds these attributes in the development build:

| Attribute | Data |
|---|---|
| `data-src` | `file:line:column` |
| `data-src-expr` | the expression text of each dynamic property |
| `data-inst` | the instance identity |

The plugin knows the original position. Therefore the pipeline does not need
source maps for the markup step.

## The two sides of a record

A static map cannot know the result of `cn("px-4", big && "mt-2")`.
The runtime cannot know the expression. The tool joins the two sides:

| Side | Source | Data |
|---|---|---|
| Static | the compiler | the expression and the position |
| Runtime | the client | the evaluated value and the props |

## The data flow

```
source files
    |
    v
[vite-plugin]  add the stamp
    |
    v
served code  ->  page  ->  [client]  register the live data
    |                        |
    |                        v
    |                   [index-service]  join and store
    |                        |
    |                        v
    |                   the record  <--  [style-resolver]  CDP
    |                        |
    |                        v
    |                   the user writes the problem
    |                        |
    v                        v
                 [agent-runner]  worktree, agent, check
                                 |
                                 v
                            [panel]  the result
```

## The rule for the agent

The agent does only four jobs.

1. Read the record.
2. Pick the repair layer: local usage or shared component.
3. Make the smallest change in the correct expression.
4. Check the result.

The agent does not search the repo. The agent does not guess a file.
