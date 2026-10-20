# Restricted observer visibility

Workspace administrators configure `observer_hidden_label_ids` (a list of existing
workspace label UUIDs) through the existing workspace PATCH API. No person,
project, label name or task number is hardcoded in the policy.

For `summary_observer` members, a labeled work item and its complete descendant
subtree are excluded before saved-view projection and counts. Normal members keep
their existing access. Removing a label assignment restores access on the next
request; changing its display name does not change access. Invalid or deleted
configured labels fail closed until an administrator repairs the configuration.

Artifacts referencing a hidden source cannot be listed, opened or streamed by
restricted observers. A published presentation referencing a hidden task cannot
be listed, opened or streamed by them. Publish a separate, reviewed document
containing only intended material; the server does not silently rewrite its text.
These rules do not revoke already downloaded documents or external shared URLs.

Deployment is additive: migration 0130 adds an empty-default JSON field. Reverting
the image alone removes this enforcement, so rollback must retain the visibility
policy or temporarily revoke observer project/view grants. Retain previous report
revisions and source data; report publication is version-checked.
