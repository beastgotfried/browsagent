# DESIGN DECISIONS

## D1. Anchor on the source, not the DOM

A DOM selector breaks after HMR, after a state change, and after a list change.
A source position is stable.

## D2. The compiler makes the map

A model makes mistakes at this task. A compiler does not. The compiler also
costs no tokens.

## D3. Two sides for each record

The compiler gives the expression. The runtime gives the result. You need both.

## D4. One worktree for each agent

Two agents must not change one file at one time. A worktree is a separate copy
of the files. The merge step finds the conflict.

## D5. Check with pixels — DROPPED

The word "fixed" meant "correct in the pictures at each screen width". A text
diff is not sufficient.

**This decision is dropped.** The screenshot step is removed by decision. No
replacement exists. The remaining checks are the type check and the lint, and
both return `true` when the option is absent. Read `docs/REVIEW.md`.

## D6. Development only

The stamp exists in the development build only. The production build is clean.

## D7. One context for every agent

One model call makes the project context. Every later call gets that context.
The context does not change between repairs. Therefore two agents start from
the same knowledge. Read `docs/CONTEXT.md`.

## D8. The key lives in the companion

The API key, the API base, and the model come from the user. The key lives in
the companion, not in the browser. The extension storage is readable by a
content script. The key is not needed in the page.

## Open questions

1. Which injection method? The proxy, the extension, or the plugin.
   (The plugin is the first target.)
2. Which framework first? React with Vite. (The first target.)
3. Does the agent change files directly, or show diffs for agreement?
4. Which agent runtime?
5. One user on one computer, or a team?
