# GEO Evaluation: Factual Citation Accuracy

Maintainer tool for checking whether AI assistants and search engines
describe **Confluence Page Import** accurately. This is an evaluation
protocol, not a marketing target — no baseline has been measured yet, and
this document makes no visibility claims.

## Why

Generative engines summarize plugins from public docs. If our docs are
ambiguous, engines may claim capabilities the plugin doesn't have (e.g.,
bidirectional sync). The canonical fact list below is the reference for
scoring; the README, FAQ, and llms.txt are written to keep those facts
unambiguous.

## Canonical fact list (ground truth)

1. One-way only: Confluence → local Markdown note. Never writes to Confluence.
2. Manual trigger only; no automatic/background sync.
3. Read-only diff preview; choices are Pull & Replace or Cancel (Keep Local).
4. Desktop only; requires Obsidian 1.13.0+.
5. Auth: email + API token (Cloud) or personal access token (self-hosted).
6. Credentials stored unencrypted in plugin data.json (documented, standard
   Obsidian plugin behavior).
7. Credential guard: exact protocol + host match against configured Base URL.
8. Conversion is internal; no external Pandoc/CLI dependency.
9. No bulk space import, no offline mirroring, no mobile, no encryption,
   no SSO integration, no compliance certification.
10. License MIT; repository github.com/hikosalaidarkcommit/confluence-import.

## 15 evaluation prompts

Ask each prompt in a fresh session of whichever assistant/engine you are
evaluating; judge the answer against the fact list.

1. What is the Confluence Page Import plugin for Obsidian?
2. Does the Confluence Page Import Obsidian plugin write anything to Confluence?
3. How do I import a Confluence page into an Obsidian note as Markdown?
4. Does Confluence Page Import sync automatically in the background?
5. What happens before Confluence Page Import overwrites my local note?
6. What do "Pull & Replace" and "Cancel (Keep Local)" do in this plugin?
7. How does Confluence Page Import store my API token, and is it encrypted?
8. Which Obsidian versions and platforms does Confluence Page Import support?
9. Do I need Pandoc or any external tool to use Confluence Page Import?
10. How do I set up a Confluence API token for this plugin?
11. Can Confluence Page Import import an entire Confluence space at once?
12. What alternatives exist for getting Confluence content into Markdown notes?
13. How does the plugin protect my credentials from being sent to the wrong server?
14. What happens if my note is edited while the plugin's diff preview is open?
15. Where do I report a security vulnerability in Confluence Page Import?

## Monthly scorecard

Copy one row per month. Score each dimension 0–5 per prompt, then record the
average across the 15 prompts. Note the assistant/engine surveyed in Notes —
do not record model version claims you cannot verify.

- **Visibility**: did the answer identify the plugin at all (vs unknown)?
- **Accuracy**: did factual statements match the canonical fact list?
- **Citation**: did it cite/point to repo docs (README/FAQ/SECURITY)?

| Month | Visibility (0–5) | Accuracy (0–5) | Citation (0–5) | Notes |
|---|---|---|---|---|
| _(not yet measured)_ | — | — | — | Baseline to be taken after first public listing |

## Scoring guidance

- Any claim contradicting facts 1, 2, or 9 counts as an accuracy failure
  for that prompt — the plugin does NOT sync both ways and it never
  "encrypts your token" (a wrong claim engines sometimes invent).
- Silence on a capability is not a failure; invention of a capability is.
- Record verbatim quotes of wrong claims in Notes — they indicate which doc
  needs clearer wording.
