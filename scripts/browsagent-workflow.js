// browsagent workflow runner.
//
// DELIVERY MODEL: direct push to main. No work branch. No pull request.
//
// Shape:
//   prep      one writer   switch to main, pull, prove the tree is clean
//   recon     parallel     read-only scouts
//   writers   SERIAL       one worker per task, each makes one commit and pushes
//   reviews   parallel     read-only reviewers
//   fix       one writer   one worker repairs the confirmed findings
//   verify    one scout    read-only check of the pushed range (no pnpm prove)
//
// The writers are serial because one repository has one working tree. Two
// writers in one tree overwrite each other.
//
// Run it like this:
//
//   subagent({
//     workflow: "scripts/browsagent-workflow.js",
//     async: true,
//     cwd: "/Users/beastgotfried/project/browser-nav",
//     model: "openrouter/~deepseek/deepseek-flash-latest:max",
//     args: {
//       topic: "the companion start command",
//       recon: ["Find how the CLI starts the service. Name the files."],
//       tasks: [
//         { key: "start", brief: "Add one command that starts the companion and the demo." }
//       ],
//       reviews: [
//         { key: "start", brief: "Check the start command. Look for a port clash." }
//       ]
//     }
//   })

const ROOT = args.root || "/Users/beastgotfried/project/browser-nav";
const BASE = args.base || "main";
const TOPIC = args.topic || "the repository";

// Plain JSON only. Each item holds a key and a brief.
const RECON = args.recon || [];
const TASKS = args.tasks || [];
const REVIEWS = args.reviews || [];

// The gates run before each commit. Both must pass.
const GATES = args.gates || ["pnpm -r typecheck", "pnpm -r build"];

// ---- The rules that every child reads ------------------------------------

function deliveryRules() {
  return [
    "REPO: " + ROOT,
    "BASE BRANCH: " + BASE,
    "TOPIC: " + TOPIC,
    "",
    "DELIVERY RULES. Read all of them before your first command.",
    "1. Your delivery is a DIRECT PUSH to " + BASE + ".",
    "   There is no work branch and no pull request. Do not make one.",
    "2. Before any work, run: git branch --show-current",
    "   The answer MUST be " + BASE + ".",
    "   If it is not, STOP at once and report. Do not switch branches yourself.",
    "3. Stage only your own files, by name: git add <path> <path>",
    "4. Then: git commit -m \"<message>\"",
    "5. Then: git push origin " + BASE,
    "6. If the push is rejected, run: git pull --rebase origin " + BASE,
    "   Then push again. NEVER use force push.",
    "7. Write the commit message in ASD-STE100 Simplified Technical English.",
    "   Short sentences. Active voice. No contractions. One topic per paragraph.",
    "8. Touch ONLY the files your task names. Do not reformat any other file.",
    "9. If the working tree holds a change that you did not make, STOP and report.",
    "10. Your final answer must give: the commit hash, the file list, the commands",
    "    you ran, and their result.",
    "11. Do not start other agents. You are not the orchestrator."
  ].join("\n");
}

function gateRules() {
  return [
    "GATES. Both must pass before you commit:",
    GATES.map(function (gate) { return "  " + gate; }).join("\n")
  ].join("\n");
}

function withRules(body) {
  return [
    deliveryRules(),
    gateRules(),
    "",
    "USEFUL FACTS:",
    "- The shared types and the wire protocol are in packages/shared/src.",
    "- The overlay class and the element readers are in packages/client/src.",
    "- The stamp attributes are data-src, data-src-expr, data-inst, data-component.",
    "- The companion is packages/index-service. The extension is packages/extension.",
    "",
    body
  ].join("\n");
}

// ---- The task builders ---------------------------------------------------

function prepTask() {
  return [
    "TASK: Prepare the working tree. This is the first step.",
    "",
    "Run these commands in order. Report the exact output of each.",
    "",
    "1. git fetch origin " + BASE,
    "2. git switch " + BASE,
    "3. git pull --ff-only origin " + BASE,
    "4. git status --short",
    "   If the output is not empty, STOP and report the dirty files.",
    "5. git branch --show-current",
    "   The answer MUST be " + BASE + ".",
    "6. git log --oneline -1",
    "",
    "Change no file. Make no commit. Make no push."
  ].join("\n");
}

function reconTask(brief) {
  return withRules([
    "TASK: " + brief,
    "",
    "This is READ-ONLY work. Change no file. Make no commit. Make no push.",
    "Give the exact file paths and the exact line numbers.",
    "Name every fact that you could not prove."
  ].join("\n"));
}

function writeTask(brief) {
  return withRules([
    "TASK: " + brief,
    "",
    "Make the smallest change that completes the task.",
    "Make ONE commit. Push it.",
    "Give the commit hash and the file list in your final answer."
  ].join("\n"));
}

function reviewTask(brief) {
  return [
    "You are a reviewer. Your job is to find real defects, not to praise the work.",
    "",
    "REPO: " + ROOT,
    "The work is already pushed to " + BASE + ".",
    "Read the pushed range:",
    "  git log --oneline origin/" + BASE + " -8",
    "  git diff HEAD~1...HEAD",
    "",
    "This is READ-ONLY work. Change no file. Make no commit. Make no push.",
    "",
    "TASK: " + brief,
    "",
    "For each finding give: the file, the line, the defect, and the exact",
    "condition that triggers it. Rank the findings by severity.",
    "If you find no defect, say so in one sentence and name what you checked."
  ].join("\n");
}

function fixTask(findings) {
  return withRules([
    "TASK: Repair the confirmed findings below.",
    "",
    "Repair only a finding that you can prove with the code. If a finding is",
    "wrong, say so and change nothing for it.",
    "Make ONE commit. Push it.",
    "",
    "THE FINDINGS:",
    findings
  ].join("\n"));
}

function verifyTask() {
  return [
    "TASK: Check the pushed work. This is the last step.",
    "",
    "REPO: " + ROOT,
    "",
    "This is READ-ONLY work. Change no file. Make no commit. Make no push.",
    "",
    "1. git log --oneline origin/" + BASE + " -6",
    "2. git status --short",
    "   The output MUST be empty.",
    "3. Run each gate:",
    GATES.map(function (gate) { return "     " + gate; }).join("\n"),
    "4. Do NOT run pnpm prove. The accept step of that proof writes the",
    "   patch into the tree, so the proof is not read-only work. Run it",
    "   only in a separate copy of the repository. Run git status --short",
    "   after the proof in every case.",
    "5. Report any file that the work touched but did not need to touch.",
    "6. Report any claim in a commit message that the code does not support.",
    "",
    "Give the exact command output for each step."
  ].join("\n");
}

// ---- The calls -----------------------------------------------------------

function reconCalls() {
  return RECON.map(function (brief, index) {
    return {
      key: "recon-" + index,
      agent: "scout",
      task: reconTask(typeof brief === "string" ? brief : brief.brief)
    };
  });
}

function reviewCalls() {
  return REVIEWS.map(function (item, index) {
    return {
      key: "review-" + (item.key || index),
      agent: "reviewer",
      task: reviewTask(item.brief || String(item))
    };
  });
}

// ---- Stage A: prepare ----------------------------------------------------

const prep = await runs.run("prep", { agent: "worker", task: prepTask() });

// ---- Stage B: recon (parallel, read-only) --------------------------------

let recon = [];
if (RECON.length > 0) recon = await runs.all(reconCalls());

// ---- Stage C: writers (SERIAL, one commit and one push each) -------------

const facts = recon
  .map(function (result, index) {
    const body = result.ok ? result.output : "This recon step failed to run.";
    return "### Recon " + (index + 1) + "\n" + body;
  })
  .join("\n\n");

let commits = [];
for (const task of TASKS) {
  const brief = typeof task === "string" ? task : task.brief;
  const key = typeof task === "string" ? String(commits.length) : task.key;
  commits = commits.concat(
    await runs.run("commit-" + key, {
      agent: "worker",
      task: writeTask([facts, "", "TASK: " + brief].join("\n"))
    })
  );
}

// ---- Stage D: reviews (parallel, read-only) ------------------------------

let reviews = [];
if (REVIEWS.length > 0) reviews = await runs.all(reviewCalls());

const findings = reviews
  .map(function (result, index) {
    const body = result.ok ? result.output : "This review failed to run.";
    return "### Review " + (index + 1) + "\n" + body;
  })
  .join("\n\n");

// ---- Stage E: repair the confirmed findings ------------------------------

let fixes = null;
if (reviews.length > 0) {
  fixes = await runs.run("fix", { agent: "worker", task: fixTask(findings) });
}

// ---- Stage F: verify -----------------------------------------------------

const verify = await runs.run("verify", { agent: "scout", task: verifyTask() });

return {
  base: BASE,
  topic: TOPIC,
  prep: { ok: prep.ok, output: prep.output },
  recon: recon.map(function (r) { return { key: r.key, ok: r.ok }; }),
  commits: commits.map(function (r) { return { key: r.key, ok: r.ok, output: r.output }; }),
  reviews: reviews.map(function (r) { return { key: r.key, ok: r.ok }; }),
  fixes: fixes === null ? null : { ok: fixes.ok, output: fixes.output },
  verify: { ok: verify.ok, output: verify.output }
};
