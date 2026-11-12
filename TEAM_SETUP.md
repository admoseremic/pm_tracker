# Editing the PM Tracker with Claude

You can change how the PM Tracker board looks and works by telling Claude what
you want in plain English. Claude makes the change and publishes it, and about
2 minutes later it's live at https://pm.trevorwithdata.com for everyone. You
don't need to know how to code.

## One-time setup (about 15 minutes)

1. **Create a free GitHub account** at https://github.com/signup if you don't
   have one. Send Trevor your GitHub **username**.
2. **Accept the invite.** GitHub will email you an invitation to collaborate on
   `admoseremic/pm_tracker`. Click **Accept**. You can also accept it at
   https://github.com/admoseremic/pm_tracker/invitations once Trevor has sent
   it.
3. **Install Git for Windows** from https://git-scm.com/downloads/win. Click
   through with the default options. If it asks, choosing **"Install for me
   only"** is fine. This is what lets Claude publish your changes.
4. **Fully quit and reopen the Claude desktop app** so it picks up Git.
5. In the Claude app, open the **Code** tab and choose your user folder (for
   example `C:\Users\yourname`). Don't use a OneDrive folder. Then paste this
   message:

   > Set me up to edit the PM Tracker board. Clone
   > https://github.com/admoseremic/pm_tracker.git into my user folder (not
   > OneDrive), then follow the "Setup steps for Claude" section in its
   > TEAM_SETUP.md.

6. Claude will ask for your name and GitHub username. At some point a
   **GitHub sign-in window** will pop up. Sign in and click **Authorize**.

That's it. Claude will tell you when you're set up.

## Making a change

1. Open the Claude app, go to the **Code** tab, and choose the **pm_tracker**
   folder (for example `C:\Users\yourname\pm_tracker`).
2. Describe what you want, for example:
   - "Add a Customer Impact field to projects and show it on the cards."
   - "Make the Delivery column header dark blue."
   - "On the WIH board, show how many days each project has been in its
     phase."
3. Claude makes the change, publishes it, and tells you when it's live (about
   2 minutes). Refresh the board to see it. If it looks unchanged, press
   **Ctrl+F5**.

**Don't like it?** Say "undo my last change."

**Board broken?** Tell Claude "the board isn't working, undo the last change,"
and let Trevor know.

## Good to know

- **Changes go live for everyone right away.** There's no review step, so
  smaller changes are safer and easier to undo.
- **Changing the tool isn't the same as changing projects.** Claude won't
  touch the projects on the board unless you ask it to.
- **The code is public on GitHub.** Don't put confidential details, like
  customer names or pricing, into labels or text that ends up in the code.
- Other people may be editing at the same time. Claude takes care of
  combining everyone's changes.

---

## Setup steps for Claude

Follow these when someone asks you to set them up. They're not a developer,
so do the work yourself and explain only what they need to do (sign in,
answer a question).

1. **Check Git.** Run `git --version`. If Git isn't installed, tell them to
   install Git for Windows from https://git-scm.com/downloads/win with the
   default options, fully quit and reopen the Claude app, and then paste the
   setup message again. Stop here until they do.
2. **Get the code.** If it isn't cloned yet, clone
   `https://github.com/admoseremic/pm_tracker.git` into their user folder
   (`%USERPROFILE%\pm_tracker`). Avoid OneDrive-synced folders, because
   syncing can corrupt the Git data.
3. **Set their name on their changes.** Ask for their full name and GitHub
   username. Look up their GitHub ID with
   `curl -s https://api.github.com/users/<username>` (the `id` field). Then,
   inside the repo, run:
   ```
   git config user.name "<Full Name>"
   git config user.email "<id>+<username>@users.noreply.github.com"
   ```
   The no-reply address keeps their work email off the public repo.
4. **Check they can publish.** Tell them a GitHub sign-in window is about to
   appear, then run `git push --dry-run origin main` in the repo. They sign
   in and click Authorize.
   - A `403` or "permission denied" error means they haven't accepted the
     invite yet. Send them to
     https://github.com/admoseremic/pm_tracker/invitations. If there's no
     invite there, Trevor needs to add their username. Try again once that's
     done.
   - If no sign-in window appears, ask them to open **Git Bash** from the
     Start menu and run `cd ~/pm_tracker && git push --dry-run origin main`
     themselves, then come back.
5. **Optional: board data tools.** Offer to connect the `pm-tracker` tools so
   they can also ask Claude about projects or update them. If the `claude`
   command is available, run
   `claude mcp add --transport http --scope user pm-tracker https://pm.trevorwithdata.com/mcp`.
   If it isn't, skip this step. They can still edit projects on the board.
6. **Finish.** Tell them they're set. Next time, they open the Code tab, pick
   the `pm_tracker` folder and describe the change they want. From then on,
   follow `CLAUDE.md` in the repo.
