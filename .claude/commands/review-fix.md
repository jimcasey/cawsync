Run a full PR review using the `review` skill, then immediately address every issue it finds.

Steps:
1. Ensure a PR exists for the current branch **before** running the review, so `review` can target the PR rather than diffing the branch against `main`.
   - Push the current branch to the remote if it has unpushed commits or no upstream.
   - Check whether a PR already exists (use the GitHub MCP tools or `gh pr view`).
     - If no PR exists, create one following the repo's PR conventions (short title, body with summary + test plan, `Closes #N` / `Fixes #N` for any issue this PR resolves).
     - If a PR exists, verify and update it as needed:
       - Title is short and descriptive with no issue references (e.g. no `(#N)` suffix) — update if needed.
       - Body includes `Closes #N` (or `Fixes #N`) for any issue this PR resolves — add if missing.
       - Body has a meaningful summary and test plan — add if the body is bare or missing.
       Update the PR via the GitHub MCP tools if any of the above are missing.
2. Invoke the `review` skill to review the PR.
3. Read the review output carefully.
4. For each issue identified (bugs, style violations, missing tests, architectural concerns, etc.), implement a fix directly in the codebase.
5. After all fixes are applied, commit the changes with a clear message summarizing what was addressed.
6. Push the commit to the current branch.
7. Summarize what was fixed and note anything that was intentionally left alone (e.g. subjective suggestions or out-of-scope changes).
