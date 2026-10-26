# لوحة متابعة مشروع الذكاء الاصطناعي المساعد

Static site (no build step) for tracking the UAE Government Agentic AI project.

| Page | What it does |
|---|---|
| `index.html#dashboard` | Stage countdown, pending meeting directives, upcoming events, UAE + global agentic AI news |
| `index.html#calendar` | تقويم الأحداث — month grid / timeline, add & edit events |
| `index.html#workspace` | مساحة العمل — Claude drafts meeting minutes from typed notes or photos into the committee's Word template |
| `index.html#minutes` | متابعة محاضر الاجتماعات — National Committee & Ministry Committee, tick items done / in progress |
| `workflow-form.html` | Previous federal workflow form |

## Data
- `data/project.json` — stages, events, meetings & directives. Edit in the UI.
- `data/news.json` — refreshed by `.github/workflows/news.yml` daily at 07:00 UAE (03:00 UTC), 3 items per section; existing items are kept when nothing new is found.

Edits made in the browser are saved locally. To save them to the repo (visible on every device), open ⚙ settings and add a fine-grained GitHub token with **Contents: read & write** on this repo only.

## Setup
1. Merge to the default branch (scheduled workflows only run there).
2. Settings → Pages → deploy from that branch, root folder.
3. Settings → Actions → General → Workflow permissions → **Read and write**.
4. Optional: run "Daily agentic AI news" manually once from the Actions tab.

## Run on your Mac (localhost)
1. Clone the repo once (e.g. with GitHub Desktop → Clone `azalmulla/website`).
2. Double-click `start.command` (first time: right-click → Open). It pulls the latest changes and opens http://localhost:8000.

Keep using port 8000 — the browser stores your edits per address.

## Workspace (AI drafting)
- Opened from its claude.ai link, the workspace uses the viewer's own Claude plan (no key needed).
- On localhost, add a Claude API key in ⚙ settings (stored on that device only; usage is billed to the API account). Calls use the official `@anthropic-ai/sdk` loaded from jsDelivr, model `claude-opus-5-5`.
- The default minutes template is `assets/templates/minutes-national.docx`, embedded as `minutes-template.js` (regenerate it after editing the .docx; the command is in that file). Any past minutes `.docx` can be uploaded as a template in the workspace: the title, date, time, attendees and the directives table are replaced, everything else (logo, fonts, layout) is kept.
