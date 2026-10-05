# لوحة متابعة مشروع الذكاء الاصطناعي المساعد

Static site (no build step) for tracking the UAE Government Agentic AI project.

| Page | What it does |
|---|---|
| `index.html#dashboard` | Stage countdown, pending meeting directives, upcoming events, UAE + global agentic AI news |
| `index.html#calendar` | تقويم الأحداث — month grid / timeline, add & edit events |
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

Local preview: `python3 -m http.server` then open http://localhost:8000.
