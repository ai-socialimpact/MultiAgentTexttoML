# ImpactLens: How to Extend It

A practical guide for a developer adding to ImpactLens. File names refer to the application source. Read [00-overview.md](00-overview.md) first.

## Code map

| Path | What lives there |
|---|---|
| `src/App.tsx` | Chooses Login, Project selection or Dashboard |
| `src/components/Dashboard.tsx` | The tab bar and which screen shows |
| `src/components/*.tsx` | One file per tab, plus shared viewers |
| `src/lib/agents.ts` | All AI prompts and the model-fallback helper |
| `src/lib/DataAgentEngine.ts` | Runs AI-written code in a Web Worker |
| `src/lib/localDb.ts` | Browser file storage (Dexie / IndexedDB) |
| `src/lib/strategicFavourites.ts` | Saved strategic bundles and CSV fingerprints |
| `src/contexts/` | Auth, current project, per-agent model choices |
| `firestore.rules`, `firebase-blueprint.json` | Database rules and data shapes |

## Recipe 1: add a new AI agent

1. Open `src/lib/agents.ts`. Add a function inside the `agents` object, next to similar ones.
2. Build the prompt string. If you want JSON back, include the word "JSON" in the prompt. The helper uses that word to switch on JSON mode and to parse the reply.
3. Call `callWithRetry('My Agent', prompt, async (model) => { ... }, preferredModel, onLog)`. The inner function is only used for Gemini models. Claude and GPT models are called by the helper itself.
4. Return `{ ...data, modelUsed }` like the other agents so screens can show which model answered.
5. Call it from a component with `agents.myAgent(args, models.<role>, addDebugLog)`.

Tip: copy `similaritySearch` or `explainFindings`. They are short and show the whole pattern.

## Recipe 2: give the new agent its own model setting

1. In `src/contexts/SettingsContext.tsx`, add the key to `ModelConfigs` and to `defaultModels`.
2. Change the version string `agent_model_configs_version`. Without this, returning users keep their old saved settings and never see the new key.
3. Add a row for it in `src/components/AgentSettings.tsx`.

## Recipe 3: add or change an AI model

- Add the model id to the `MODELS` list at the top of `agents.ts`. The order is the fallback order when a model is rate limited or overloaded.
- Names starting with `claude` go to Anthropic, names starting with `gpt` go to OpenAI, anything else goes to Gemini. A new vendor needs a new branch in `callWithRetry`.
- Add the same id to the picker in `AgentSettings.tsx`.

## Recipe 4: add a new tab

1. Create `src/components/MyTab.tsx` exporting a React component. Use `useProject()` for the current project and `useAuth()` for the user.
2. In `Dashboard.tsx`: add the id to the `Tab` type, add an entry to the `tabs` array (label and a lucide icon), and add a line `{activeTab === 'my_tab' && <MyTab />}` in the main area.
3. To pass data between tabs (as Strategic does for Consistency), keep the value in `Dashboard` state and pass it as a prop with a clear-callback.

## Recipe 5: load project data and run analysis

Copy the pattern in `Wizard.tsx` (around the CSV loading code):

1. Read the project's CSVs from `localDb.files` by `projectId` and file name.
2. Parse each with PapaParse (`header: true`, `dynamicTyping: true`, `skipEmptyLines: true`).
3. Build a `datasets` object keyed by file name.
4. `new DataAgentEngine().runAnalysis(code, datasets, onLog)`. It tests on 5 rows first, then runs everything.

The AI-written code receives `data`, `dfd` (Danfo.js) and `tf` (TensorFlow.js). To make another library available, add an `importScripts(...)` line inside the worker source in `DataAgentEngine.ts`, and mention it in the prompt in `generateCode`.

## Recipe 6: store something new in Firestore

1. Write with `addDoc(collection(db, 'favourites'), data)` or `setDoc`. Always include `userId` and `projectId`.
2. **Update `firestore.rules`.** Each collection has an `isValid...` function with an allowed-fields list (`hasOnly`). A new field is rejected until you add it there, with a type and size limit. This is the most common cause of "permission denied" after adding a feature.
3. Update `firebase-blueprint.json` so the documented shape matches. (It is already missing `dataFiles`.)
4. Strip `undefined` values before saving. `AnswerStrategically.tsx` has a `sanitizeForFirestore` helper for this.
5. Redeploy the rules (`firebase deploy --only firestore:rules`).

## Recipe 7: add a new audience persona

Personas live in `src/lib/dossierPersonas.ts` (school student, college graduate, NGO leader, data scientist). Add an entry there. The explainer and dossier screens read this list.

## Recipe 8: add a new result display

`SmartResultViewer.tsx` picks a template (summary, table, explorer, raw) from the shape of the result. Add a new template there, and extend the shape detection. `.aistudio/artifacts/brain/.../implementation_plan.md` describes the intent.

## Suggested improvements, in order of value

1. **Move AI calls behind a small server.** Create a cloud function or Express route that holds the keys and forwards prompts. Replace the three SDK clients at the top of `agents.ts` with one `fetch` to it. Remove the key injection from `vite.config.ts`. This is the one change most worth doing before real use.
2. **Add tests.** Start with pure helpers: result normalising in `SmartResultViewer`, `sanitizeForFirestore`, CSV fingerprinting in `strategicFavourites.ts`. Then a few agent calls against a mocked `callWithRetry`.
3. **Split the giant files.** `AnswerStrategically.tsx` (about 6,000 lines) and `ConsistencyReportModal.tsx` (about 3,000) are hard to change safely. Pull out the step cards, the dossier view and the Firestore code into their own files.
4. **Share data across devices.** Upload CSVs to Firebase Storage (already initialised in `firebase.ts`, not yet used) instead of IndexedDB only, and add matching storage rules.
5. **Tighten the sandbox.** Run the worker inside a sandboxed iframe with a strict content-security policy, and self-host Danfo.js and TensorFlow.js instead of loading them from a CDN.
6. **Control cost.** Add a per-user daily call limit on the server, and log token use per agent.
7. **Tidy.** Rename the package, remove unused `express`/`tsx`, and fix the README to list all three keys.

## Before you merge a change

- Run `npm run lint` (this is the TypeScript check) and `npm run build`.
- Try the Wizard end to end with a small CSV, once with a question that should fail, to see the retry loop work.
- If you touched Firestore, test a save and a reload with a real signed-in user.
