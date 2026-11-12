# PM Tracker: instructions for Claude

This is the team's product roadmap board (a kanban board). It's live at
**https://pm.trevorwithdata.com**. The people asking you for changes run UKG
product teams and are **not developers**. Most are on Windows and use the
Claude desktop app.

## How to work with them

- Talk in plain language. Don't explain git, JavaScript or Firebase unless
  they ask. Say "publish" and "go live", not "commit" and "push".
- Do all the technical work yourself, from start to finish. Don't ask them
  to run commands, edit files or make technical choices.
- If a request is unclear, ask **one** short question about what they want
  to see on the board, then make the change.
- When you're done, tell them what changed in a sentence or two, give them
  the link to look at, and say they may need to refresh.

## The rule that matters most: pushing to `main` publishes the change

Any commit pushed to `main` goes live for everyone in about 2 minutes, through
GitHub Actions (`.github/workflows/deploy.yml`). There's no review step. That's
deliberate: the team wants to make a change and see it live.

- Commit and push straight to `main`. **Don't create branches or pull
  requests.** Pull requests also deploy to the live site, so they aren't a
  safe preview.
- Never force-push, rewrite history or delete branches.
- The repository is **public**. Keep confidential details (customer names,
  pricing, unannounced plans) out of code, comments and commit messages.

## Making a change, step by step

1. **Get the latest version first.** Other people edit this too.
   `git pull --rebase origin main`
2. **Make the smallest change that does what they asked.** Don't tidy up or
   reformat unrelated code. Smaller changes are less likely to collide with
   someone else's.
3. **Check your work.** If `node` is available, run `node --check app.js` (and
   `node --check functions/server.js` if you changed it). If it isn't, re-read
   every block you edited and look for unmatched brackets, quotes and commas.
   One syntax error in `app.js` breaks the whole board for everyone.
4. **Confirm first if the change is risky.** That means anything that deletes
   or renames existing data fields, changes the phase or board keys stored on
   projects, or removes a feature people use. Explain in one sentence what
   would happen and ask before you publish.
5. **Commit with a clear one-line message** that says what changed on the
   board, e.g. `Add Customer Impact field to project cards`. Then
   `git push origin main`.
   - If the push is rejected because someone else published first, run
     `git pull --rebase origin main` and push again. If that causes a merge
     conflict, keep both people's changes; never throw away someone else's
     work.
6. **Wait for the deploy to finish.** Get the commit with
   `git rev-parse HEAD`, then check every 20–30 seconds until `status` is
   `completed`:
   ```
   curl -s "https://api.github.com/repos/admoseremic/pm_tracker/actions/runs?head_sha=<SHA>"
   ```
   Read `workflow_runs[0].status` and `.conclusion`. In PowerShell, use
   `Invoke-RestMethod` with the same URL. If `gh` is installed and signed in,
   `gh run watch` works too.
7. **Check that it's live.** If you have browser tools, open the board they
   use (for example https://pm.trevorwithdata.com/wih), look for console
   errors, and take a screenshot to show them. Otherwise tell them to refresh
   the page. Ctrl+F5 forces a full reload if it looks unchanged.

### If the deploy fails or the board breaks

Undo the change with `git revert --no-edit <SHA>` and `git push origin main`.
Tell them in plain words what happened, say the board is back to how it was,
and suggest they let Trevor know. Use `gh run view <run-id> --log-failed` to
see why the deploy failed if `gh` is available.

### "Undo my last change"

Find their most recent commit with `git log --oneline -10`, confirm which one
with them if it isn't obvious, then `git revert` it and push. Don't use
`git reset`.

## How the app is built

It's a plain website with no build step and no framework. The files are
deployed exactly as they are.

| File | What's in it |
|---|---|
| `index.html` | Page layout, every popup (new/edit project, project details, phase change) and **all the styling** (one `<style>` block at the top). |
| `app.js` | Everything the board does: loading projects, drawing cards, drag and drop, filters, saving edits, comments. |
| `functions/server.js` | The `pm-tracker` tools Claude uses to read and edit board data (the MCP server at `/mcp`). |
| `functions/index.js` | Wires the tools above into a Firebase Function. You rarely need to touch it. |
| `firebase.json` | Hosting settings: routing, which files get published, caching. |
| `.github/workflows/deploy.yml` | The automatic deploy. **Don't change it**; ask Trevor. |

### Where things are in `app.js`

- `firebaseConfig` at the top connects to the live database. Don't change it.
- `PHASES`: the five columns (idea, discovery, planning, ready, delivery),
  their names and colors.
- `TRANSITION_REQUIREMENTS`: what a project needs before moving to the next
  phase.
- `BOARD_CONFIGS`: the board pages (`/cr`, `/wih`, `/hp`, `/classicapps`,
  `/trevor`, `/benchmarks`). Each page shows projects whose `boards` list
  includes that key. Adding `?released=true` to a board's address also shows a
  Delivered column with released projects.
- `renderProjects`, `createProjectCard`, `createDeliveryInfo`,
  `createDiscoveryValidation`: how the cards are drawn.
- `createProject`, `editProject`, `updateProject`: the new/edit form, which
  reads fields from `index.html`.
- `showProjectDetail`: the project detail popup.
- Comments live at the bottom of the file (`renderComments`, `addComment`).

### Project data

Projects are stored in the live Firebase Realtime Database under `projects/`.
Main fields: `id`, `title`, `description`, `phase`, `priority` (1 = top of the
column), `pm_owner`, `dev_lead`, `ux_lead`, `loe_estimate`, `jira_link`,
`engineering_teams`, `boards` (a list such as `["wih", "trevor"]`),
`artifacts`, `discovery_validation` (`value`, `usability`, `feasibility`,
`viability`), `release_confidence` (`green`/`yellow`/`red`), `released`,
`phase_history` and `comments`.

## Things that have to change together

- **Adding a board** means changing three places: `BOARD_CONFIGS` in
  `app.js`, the board checkboxes in `index.html` (search for
  `board-benchmarks`) together with `getSelectedBoards` and `setSelectedBoards`
  in `app.js`, and `BOARDS` near the top of `functions/server.js`.
- **Adding a project field**: add the input to the form in `index.html`, then
  update `createProject`, `editProject` and `updateProject`, and the card or
  detail view if it should show there. If Claude should be able to set the
  field through the `pm-tracker` tools, add it to the `update_project` and
  `create_project` tools in `functions/server.js` too.
- **Phases or artifact names** are listed in both `app.js` and
  `functions/server.js`, so keep them the same. Renaming a phase or field that
  existing projects already use would hide or break those projects, so ask
  Trevor first.
- After a change to `functions/server.js` goes live, anyone using the
  `pm-tracker` tools needs to start a new Claude session to see it.

## Data safety

The app and the `pm-tracker` tools both work on the **live** board data, and
there's no separate test copy. Don't write scripts that change the database
directly. Change projects only when someone asks, through the board or the
`pm-tracker` tools. Opening `index.html` on your own computer also shows the
live data, and anything you click there really saves.
