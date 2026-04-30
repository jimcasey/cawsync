Run a full PR review using the `review` skill, then immediately address every issue it finds.

Steps:
1. Invoke the `review` skill to review the current branch's changes.
2. Read the review output carefully.
3. For each issue identified (bugs, style violations, missing tests, architectural concerns, etc.), implement a fix directly in the codebase.
4. After all fixes are applied, commit the changes with a clear message summarizing what was addressed.
5. Push the commit to the current branch.
6. Summarize what was fixed and note anything that was intentionally left alone (e.g. subjective suggestions or out-of-scope changes).
