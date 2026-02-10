---
description: Build all issues in sequence from docs/issues/
---

# Build

Process and implement all issues in the `docs/issues/` directory sequentially, tracking progress in `docs/issues/status.md`.

## Workflow

1. **Discover Issues**
   - Use Glob to find all issue files in `docs/issues/` (exclude `status.md`)
   - Sort issues by filename (numeric prefix) to ensure correct order
   - Read the first issue to understand the work scope

2. **Create Status File**
   - Create or overwrite `docs/issues/status.md` file
   - Use markdown format with this structure:
     ```markdown
     # Project Execution Status

     Last Updated: [timestamp]

     ## Issues

     - [ ] 001-issue-name.md - pending
     - [ ] 002-issue-name.md - pending
     - [ ] 003-issue-name.md - pending

     ## Summary

     Total: X issues
     Completed: 0
     In Progress: 0
     Pending: X
     Failed: 0

     ## Execution Log

     [Entries will be added as issues are processed]

     ## Notes

     [Add any important notes, blockers, or decisions here]
     ```

3. **Execute Issues Sequentially**
   - For each issue in the status file:
     a. Update the issue line to `- [ ] [filename] - in_progress`
     b. Add entry to Execution Log: `### [filename] - Started at [timestamp]`
     c. Execute `/run @docs/issues/[filename]` to complete the issue
     d. Wait for the /run command to fully complete before continuing
     e. If successful:
        - Update issue line to `- [x] [filename] - completed`
        - Add to log: `Result: Success`
        - Update Summary counters
     f. If failed:
        - Keep as `- [ ] [filename] - failed`
        - Add to log: `Result: Failed - [error details]`
        - Ask user: retry, skip, or stop
     g. Move to the next issue

4. **Handle Errors**
   - If an issue fails during /run:
     - Mark the issue as `failed` in docs/issues/status.md
     - Log the error details in the Execution Log
     - Add troubleshooting notes to Notes section
     - Ask the user whether to:
       - **Retry**: Re-run the same issue
       - **Skip**: Mark as failed and continue to next issue
       - **Stop**: Halt execution and provide summary

5. **Completion Summary**
   - After all issues are processed, update docs/issues/status.md with final summary
   - Provide user with:
     - Total issues processed
     - Successfully completed issues
     - Failed issues (if any)
     - Link to `docs/issues/status.md` for full execution history

## Important Notes

- **Sequential Processing**: Complete one issue fully before starting the next
- **No Parallel Execution**: Issues may have dependencies on previous issues
- **Respect /run Workflow**: Each issue goes through plan -> execute phases
- **State Tracking**: docs/issues/status.md tracks project execution status
- **Resumability**: If execution stops, status.md shows what's completed and what's pending
