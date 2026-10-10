# Filtered hierarchy repair

The project issue list now filters every work item before choosing collapsed roots. A matching item whose direct parent is not in the matching set is a visible root. Matching children remain nested and are fetched with the same filters. Root selection occurs before grouping and pagination.

Production verification on 2026-10-10, reporting interval 2026-09-28 through 2026-10-10:

- Previous root-only query omitted AISTRAT-58 despite its October 8 start and target dates.
- Independent matching set: 19 active work items.
- New collapsed query: 11 roots, including AISTRAT-58, 21 and 93.
- Actual browser: expand all reached 19 unique work items; collapse returned 11.
- Reload retained AISTRAT-58 and default collapsed presentation.
- Canonical API rich filters excluded AISTRAT-20 carrying the exclusion label.
- Daily refresh script retains date bounds and uses the new root selection for verification.

Backend deployed: bokang/plane-backend:1.4.2-12c6988. Compose rollback copy: compose.before-filtered-hierarchy.yaml. No schema migration or task content edits.

Known pre-existing browser hydration and NOT-filter editor conversion errors remain outside this repair; server-side NOT filtering is verified.
