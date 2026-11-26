# ImpactLens Documentation

Open [index.html](index.html) for the web version.

Documentation for ImpactLens, a browser-based tool that lets NGO staff ask questions about their CSV data in plain English and get explained answers.

## Index

| # | File | What it covers |
|---|---|---|
| 0 | [00-overview.md](00-overview.md) (web: `00-overview.html`) | What the app does, components, data flows, dependencies, setup, risks and gaps |
| 1 | [01-design-diagrams.html](01-design-diagrams.html) | Six diagrams: idea, architecture, retry loop, strategic and consistency modes, where data lives, roles and online file loading. Open in a browser. |
| 2 | [02-how-to-extend.md](02-how-to-extend.md) (web: `02-how-to-extend.html`) | Code map, recipes (add an agent, model, tab, Firestore field, persona, viewer) and a ranked improvement list |

## GitHub Pages

Publish this folder with GitHub Pages (Settings > Pages > deploy from branch, then pick the folder holding `index.html`). `index.html` is the landing page, and `.nojekyll` makes Pages serve the files as they are.

## Suggested reading order

1. Start with the overview (00).
2. Look at the diagrams (01) for the pictures.
3. Use the extend guide (02) when you start changing code.

## Version

Updated for the November 26 version of the app (roles, online file loading and encrypted CSVs added).

## Scope

These documents describe the code as uploaded. They were written from reading the source and configuration. The app was not run. Deployment is not covered here.
