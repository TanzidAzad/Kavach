# CLAUDE.md — Kavach

Read `PRD.md` before doing anything. It is the source of truth.

## Who you're working with
Four teammates each run their own Claude Code on this repo. Each owns one role (PRD section 9). The user will tell you their role at the start ("I'm Role 2"). If they don't, ask.

Branch per role: Role 1 → `ui` · Role 2 → `core` · Role 3 → `agent` · Role 4 → `data`.

## Git — do this every session, without being asked
1. **At the start:** run `git status` and `git branch`. Make sure you're on the user's role branch, NOT `main`. If the branch doesn't exist yet: `git checkout -b <branch>` then `git push -u origin <branch>`. Then run `git pull origin main` to get teammates' merged work.
2. **After every small step that works** (roughly every 15–30 min): commit and push.
   - Stage only files in this role's folders: `git add popup/ manifest.json` (example) — **never `git add .` or `git add -A`**.
   - Message format: `[core] add validateCaseNumber` (role tag in brackets).
   - Then `git push`.
3. **Every ~2 hours, or when the user says "merge":** `git pull origin main` into the branch, make sure nothing broke, push, then tell the user to open a Pull Request into `main` on GitHub and post in the team chat. (If `gh` is set up, you may open the PR with `gh pr create --base main`.)
4. **Never:** commit to `main` directly, `git push --force`, commit `.env` / API keys / `node_modules/`, or rewrite history.
5. **Merge conflicts:** if the conflict is only in this role's folders, resolve it carefully and test. If it touches another role's files, STOP and tell the user to ask that teammate. Never guess on someone else's code.

## Rules
- **Only edit files in your role's folders** (PRD section 11 table). If a change is needed elsewhere, tell the user exactly what to ask the owner.
- Don't reformat, rename, or "clean up" files you don't own.
- **Do not change the shared contracts in PRD section 8** (data shapes, function names, endpoints) unless the user says the whole team agreed.
- If another role's code isn't ready, **use a mock** that matches the contract. Never block.
- Plain JavaScript, Chrome Manifest V3, no build step, no frameworks, no TypeScript. Server is Node + Express.
- Keep the UI clean and simple: one popup screen, PRD section 5 design rules. Don't add tabs, pages, settings screens, or extra colors.
- Never put API keys in extension code. Key only in `server/.env` (gitignored).
- The AI/model must never generate phone numbers or URLs; those come only from `data/official_contacts.json`.
- Prefer small working steps. After each step, tell the user how to test it in Chrome (`chrome://extensions` → Load unpacked → reload).
- Explain things in plain language — the team is not very technical.
