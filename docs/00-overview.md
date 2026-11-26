# ImpactLens: High-Level Design

A plain-language guide to what ImpactLens does, how it is put together, and where it needs attention. Based on the source code ("Oct 10 vN1 Tech4Dev: ImpactLens").

## What changed in the November 26 version

This guide covers the upgraded app. Compared with the first version, it adds:

- **Two access levels (roles).** After Google sign-in, the user picks **Pro** or **Basic** and types that role's password. Pro sees every tab. Basic sees only Favourites, History, Saved Queries and Files. A wrong password locks the screen for 20 minutes the first time and 60 minutes after each later mistake.
- **Load data from the internet.** The Files tab can fetch project files from a GitHub repository (or a direct file link) instead of uploading them by hand.
- **Encrypted CSVs.** Files ending in `.csv.enc` are decrypted in the browser (AES-GCM) and stored like normal CSVs.
- **New project flow.** A new project opens straight on the Files tab. Returning Pro users land on Answer Strategically, Basic users on Favourites. Tab order changed, and Wizard is no longer first.
- **Header changes.** A role badge and a **Switch Role** button.
- **A new Firebase database** (new project config values). Firestore rules and the AI agents are unchanged.

## 1. What the app does

ImpactLens lets people at NGOs ask questions about their data in plain English and get answers back, without writing code. The user uploads CSV files and a short description of the columns. They type a question such as "which districts improved most?". The app uses AI models to turn that question into a small analysis program, runs it in the browser on the user's data, checks the result, and explains it in simple language.

**Who uses it:** NGO interns, volunteers, program leaders, and data scientists. The explanations can be written for four audiences: a school-student intern, a college-graduate volunteer, an NGO program leader, or a data scientist.

**Main things a user can do (the tabs in the app):**

| Tab | What it is for |
|---|---|
| Wizard | Step-by-step: ask a question, review the plan, run the analysis, read the explanation. Results can be saved as favourites. |
| Answer Consistency | Runs the same question several times in different ways to see whether the answer is stable. Produces a consistency report. |
| Answer Strategically | Breaks a big question into about five sub-questions, answers each with data, and writes a "strategic dossier" (verdict, summary, recommendations, risks). |
| Saved Queries | Re-runs saved strategic dossiers, including on new data. |
| Strategist Wizard | Suggests strategy questions from the data and from past favourites. |
| Fast track | Searches saved favourites for ones similar to a new question. |
| Favourites / History | Saved analyses and a log of past runs. Favourites can be re-run on other data. |
| Files in DB | Upload CSVs and the schema and example files for a project. |
| Agent Settings | Choose which AI model each "agent" uses. |

**Access by role.** Pro: all tabs above. Basic: Favourites, History, Saved Queries and Files only. Basic users can run saved queries but cannot open them in Answer Strategically.

## 2. Architecture at a glance

ImpactLens is a **single-page web app that runs entirely in the browser**. There is no application server of its own. It talks directly to Firebase (login and saved data) and to AI providers (Anthropic, OpenAI, Google Gemini). See [01-design-diagrams.html](01-design-diagrams.html) for pictures.

```
+---------------------------- User's browser -----------------------------+
|                                                                         |
|  React UI (Dashboard with 10 tabs)                                      |
|     |                                                                   |
|     +--> Contexts: Auth | Project | Settings (model choices)            |
|     |                                                                   |
|     +--> Agents (agents.ts) --- prompts + model fallback ---------------+--> AI providers
|     |                                                                   |    Claude / GPT / Gemini
|     +--> Data Agent Engine --> Web Worker sandbox                       |
|     |        runs AI-written JS with Danfo.js + TensorFlow.js           |
|     |                                                                   |
|     +--> Local storage: IndexedDB (CSV files), localStorage (settings)  |
|                                                                         |
+--------------------------------+----------------------------------------+
                                 |
                                 v
                  Firebase: Google sign-in + Firestore
          (users, projects, history, favourites; owner-only rules)
```

### Main components

- **UI shell (`App.tsx`, `Dashboard.tsx`).** Shows Login, then Project selection, then the tabbed Dashboard.
- **Role gate (`ProjectSelection.tsx`, `AuthContext.tsx`).** After sign-in the user chooses Pro or Basic and enters a password. The chosen role is held in memory only, so a page reload asks again. `Dashboard.tsx` filters tabs by role.
- **Contexts.** `AuthContext` handles Google sign-in, creates a user record and holds the role. `ProjectContext` lists and creates the user's projects (live from Firestore). `SettingsContext` stores which model each agent uses, in the browser.
- **Agents (`lib/agents.ts`, about 40 functions).** Each is a prompt plus parsing. Examples: Query Interpreter (rewrites the question to match column names), Planner, Code Generator, Evaluator, Error Analyzer, Explainer, and the strategy and consistency agents. A shared helper tries the chosen model first and moves to the next model in a list if it hits rate limits or overload.
- **Data Agent Engine (`lib/DataAgentEngine.ts`).** Runs the AI-written code inside a Web Worker. It first tests on a 5-row sample (5 s limit), then runs on the full data (60 s limit). The code can use `data`, Danfo.js (`dfd`) and TensorFlow.js (`tf`).
- **Result viewers.** `SmartResultViewer` and `FormattedAnswerDisplay` show any result (text, tables, charts, nested JSON) readably. `ConsistencyReportModal` shows consistency reports.
- **Online file loader (`Files.tsx`).** Lists a GitHub repository through the GitHub API (or takes a direct file URL), downloads the supported files, decrypts `.csv.enc` files in the browser, and saves everything like a normal upload. If a repository has encrypted CSVs it skips the plain ones.
- **Storage.** CSV files stay in the browser (IndexedDB via Dexie). Projects, history and favourites go to Firestore.

## 3. Key data flows

**0. Getting data in (Files tab)**
1. Either upload files from the computer, or enter a GitHub repository URL (or direct file links) and press fetch.
2. For a repository, the app lists its top-level files (or a sub-folder) and picks `schemadescription.txt`, `few_shot_description.txt`, `classifer_guidelines.txt`, `Few_shot_examples.json` and the CSVs.
3. Files ending `.csv.enc` are decrypted in the browser with a passphrase typed in the form, and saved as `.csv`.
4. CSVs go to IndexedDB. The text files go into the Firestore project record. Progress and errors show on the page.

**A. Asking a question (Wizard)**
1. User types a question. The Query Interpreter rewrites it using the project's schema description.
2. The Planner writes an analysis plan; the user can edit it.
3. The Code Generator writes JavaScript for the plan.
4. The engine runs it in the worker on the parsed CSV data (CSV read from IndexedDB, parsed with PapaParse).
5. The Evaluator checks the result. If it failed or looks wrong, the Error Analyzer explains why and the code is regenerated (the last 3 attempts are kept).
6. The Explainer writes the narrative. The run is saved to Firestore `history`; the user can star it into `favourites`.

**B. Strategic dossier.** The question is split into sub-questions. Each goes through interpret, plan, code, run, and evaluate. A final agent combines the evidence into a dossier. The bundle is saved to `favourites` with a SHA-256 fingerprint of each CSV, so a re-run can tell whether the data changed.

**C. Consistency check.** One question is planned into several variants. Each is run independently. An agent compares the answers and produces a report.

**D. Favourite search.** Favourites for the project are loaded and an AI model picks the closest matches to a new question.

**What comes in from outside:** project files fetched from GitHub. **What leaves the browser:** the question, the column schema, a sample of data and results are sent inside prompts to the AI providers. Projects, history and favourites go to Firestore. Raw CSV files are not uploaded.

## 4. External dependencies

| Service | Used for |
|---|---|
| Firebase Auth (Google sign-in) | Login |
| Firestore | Users, projects, history, favourites |
| Anthropic, OpenAI, Google Gemini APIs | All AI agents. Default models are Claude Sonnet 5.5 and Haiku 5.5. |
| jsDelivr CDN | Loads Danfo.js and TensorFlow.js into the worker at run time |
| GitHub API and raw.githubusercontent.com | Optional: download project files from a repository |

Main libraries: React 19, Vite 6, Tailwind 4, Chart.js, PapaParse, Dexie, Danfo.js, TensorFlow.js, Zod.

**Data model (Firestore):** `users`, `projects` (name, schema text, few-shot examples, file list), `history` (query, code, status, narrative), `favourites` (history fields plus plan, result, and for strategic ones the fingerprints, steps and dossier). Firestore rules deny everything by default and allow each signed-in user to read and write only their own records, with size limits.

## 5. Setup and run

From the README and config files:

1. Install Node.js, then run `npm install`.
2. Copy `.env.example` to `.env.local` and set `GEMINI_DEFAULT_API_KEY`, `OPENAI_DEFAULT_API_KEY` and `CLAUDE_DEFAULT_API_KEY`. (The README mentions only the Gemini key, but the default models are Claude, so the Claude key is needed in practice.)
3. `npm run dev` starts the app at http://localhost:3000. `npm run build` builds it; `npm run lint` runs the TypeScript check.
4. The app points at a Firebase project set in `firebase-applet-config.json`. To use your own, replace that file and deploy `firestore.rules`. Enable Google sign-in in Firebase.
5. In the app: sign in, choose a role and enter its password, then create a project. It opens on **Files in DB**, where you upload your CSVs plus `schemadescription.txt`, or fetch them from a GitHub repository. Use the Pro role to get the analysis tabs. Optional: `few_shot_description.txt`, `classifer_guidelines.txt` (spelled this way in the code), `Few_shot_examples.json`.

The app was generated in Google AI Studio and is set up to be hosted there.

## 6. Gaps, risks and unclear areas

**Needs attention**
- **The role passwords are not real security.** The Pro and Basic passwords are written in the JavaScript that every visitor downloads, so anyone can read them. Roles are checked only in the browser, and Firestore rules know nothing about them. The lockout timer lives in the browser's localStorage, so clearing it resets it. Treat roles as a convenience that hides tabs, not as access control. For real control, store each user's role in Firestore (set by an admin) and enforce it in the rules.
- **A default decryption key and default repository URL are in the source.** The decryption passphrase pre-fills the Files form and is also in the downloaded code, so the encryption protects the files only while they sit in the repository, not from anyone who uses the app. If the repository is public, the encrypted files are public too. Use a private repository (this app calls GitHub without a token, so it cannot read private ones) or a per-user key.
- **AI keys are exposed in the browser.** `vite.config.ts` bakes the keys into the JavaScript, and the SDKs are created with `dangerouslyAllowBrowser: true`. Anyone who opens the deployed site can read and use the keys. Fix: send AI calls through a small server or cloud function that holds the keys.
- **AI-written code runs with `new Function` in a worker.** A worker keeps it off the page, but it is not a strict sandbox. It can still make network requests and use the loaded libraries. Prompt-injected or faulty code could send data out. Consider tighter limits.
- **Scripts load from a public CDN at run time**, unpinned to a hash. The app breaks offline and depends on the CDN being trusted.
- **Data sent to third-party AI providers.** Samples and results go to three vendors. NGOs handling sensitive beneficiary data should confirm this is acceptable and say so in the UI.

**Worth fixing**
- **CSV files live only in one browser.** If the user clears site data or switches device, the files are gone, but projects still list them. Teammates cannot share a project's data.
- **No server, tests, or CI.** There are no automated tests. `express` and `tsx` are installed but unused. `firebase/storage` is initialised but not used.
- **Very large components.** `AnswerStrategically.tsx` is about 6,000 lines and `ConsistencyReportModal.tsx` about 3,000, which makes changes risky.
- **Model list may not match your accounts.** `agents.ts` falls back through a hard-coded list of 11 model names across three vendors. Some names look like previews or may not exist for your keys. Failures are retried silently on the next model, which can mask problems and change results and cost.
- **Fetching is limited.** Only one folder level is listed, GitHub's unauthenticated limit is about 60 requests an hour per visitor, and a big encrypted CSV is decrypted fully in memory.
- **Small mismatches.** `package.json` is named `react-example`; the README does not mention the Claude or OpenAI keys; the Firestore blueprint omits the `dataFiles` field that the rules and code use; the role badge reads "Role 1: Pro Level" / "Role 2: Basic Level".

**Unclear from the code**
- Where it is meant to be deployed beyond AI Studio, and who the intended users and data volumes are.
- Whether sharing projects between users is wanted (rules currently allow owner-only).
- Cost controls: there is no usage limit on AI calls, and consistency and strategic runs make many calls per question.

*Note: this review read the structure, configuration and main flows. It did not run the app, and the largest UI files were skimmed rather than read line by line.*
