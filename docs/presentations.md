# Presentations

Presentations are project-owned, editable works, rendered with reveal.js. They can
be used for weekly reporting or another subject. Weekly content is data, not a
special case in the renderer or authorization model.

## Existing capabilities retained

| Existing boundary | Treatment |
| --- | --- |
| Projects, work items, comments, attachments | Remain the source of work facts; presentations reference them |
| Artifact/gallery CRUD and publishing | Separate lifecycle; no requirement to create an artifact before presenting work |
| Workspace/project roles | Required on every presentation read/write |
| Summary observer project grants | Published presentations and their explicitly included materials only |
| Existing task detail restrictions | Unchanged; a presentation does not grant task-detail access |
| Attachment preview service | Reused, with presentation/revision authorization |
| Browser authentication and intranet origin | Relative routes; no FRP/public address configuration |

## Direction decision

- Outcome: one direct entry, horizontal narrative, optional vertical detail,
  visible real evidence, editable content and stable published versions.
- Decision: a generic project-bound document, draft edits, immutable publication
  snapshots, and optimistic write versions. Source records are never rewritten
  by publication.
- Alternatives: a static HTML file is initially cheaper but has no human editor
  or publication/permission lifecycle. Extending the artifact object would mix
  persistent showcase and period-specific presentation concerns.
- Counter-case: a presentation assembled from unrelated projects cannot use the
  first version's single-project authorization. Keep it in one project rather
  than silently broadening reader scope.
- Revisit if cross-project presentations become a real requirement. Do not
  implement workspace-wide access by inference.
- Pilot: source-derived six-section report, real image/PDF/Markdown references,
  draft edit/publish/read-back, stale edit conflict, revoked scope denial.

## Content and publication

The document contains ordered sections and ordered slides. The first slide in
each section is its horizontal summary; following slides form the vertical
stack. Content uses Markdown text, explicit media references, source work items,
links, and speaker notes. Arbitrary executable HTML is not a supported format.

Saving changes updates a draft. Publishing snapshots the selected title and
document. Readers continue to see the previous publication until the next
publication; edits must include the current version to avoid overwriting
someone else's work. Human and agent editors use the same content contract.

The first report distinguishes the previous calendar week from Monday additions
and backfilled records. Missing future plans remain unconfirmed; generating a
presentation does not create commitments or inferred business results.

## Evidence

Show selected real pages/images rather than naked attachment links. Derived
previews remain authorized assets associated with the presentation, retaining
the original asset ID and the selected page/region in their metadata. Do not
overwrite or expose source attachments as public static files. Rendering a page
does not establish that the document was accepted or used by the business.

## Reader journeys

- Editor: workspace sidebar → presentation → edit draft → save → preview → publish.
- Member reader: workspace sidebar → published presentation → optional material
  preview → close and continue at the same slide.
- Summary observer: only published content in a granted project; no drafts,
  writes or source task detail. Materials remain bounded to the publication.
- Project guests may read the materials explicitly selected in a published
  presentation in their project, including materials sourced from another
  member's issue. That publication grant does not grant direct access to the
  source issue or its ordinary attachment routes; unselected assets remain
  unavailable through presentation media URLs.
- Nonmember or revoked project member: denied by the backend, including direct
  media URLs and signed-preview source requests.

## reveal.js provenance

The runtime is vendored from the upstream 6.0.2 release, with the MIT license and
SHA-256/source blob manifest in `apps/web/public/vendor/reveal/6.0.2/`.
Production does not load reveal.js from a CDN. Its styles and keyboard controls
are isolated from the existing application. Upgrade by replacing the pinned
runtime, checking upstream changes, and rerunning the browser navigation and
preview tests.

## Editing and agent maintenance

The workspace sidebar entry is **汇报与演示**. Opening an existing work shows
its publication. **编辑内容** opens the draft, **保存** keeps draft changes,
**预览草稿** shows the saved draft, and **发布** replaces the reader-facing
version. Work item and material selections reuse existing project sources;
presentation publication does not update those source records.

Browser/session routes live under `/api/workspaces/{slug}/presentations/`.
API keys use the same resource contract under
`/api/v1/workspaces/{slug}/presentations/`. Operations are list/create,
get/update/delete by UUID, and `POST {id}/publish/`. Update, delete and publish
require the last read integer `version`; a stale version returns 409. Read the
current draft and merge edits instead of silently retrying an old document.

Minimal document example:

```json
{
  "schema_version": 1,
  "sections": [{
    "id": "6d4013c3-dbc9-49aa-b7d2-1f42611bb457",
    "title": "Topic",
    "slides": [{
      "id": "1b276c72-6d6d-49c4-8602-5d6124784b32",
      "title": "What changed",
      "body": "**Result** and the evidence supporting it.",
      "notes": "Private to users who can edit this presentation.",
      "issue_ids": [],
      "media": [],
      "links": []
    }]
  }]
}
```

A media reference is `{ "asset_id": "<source UUID>", "caption": "..." }`.
An optional `preview_asset_id` points to a source-bound presentation preview;
it never replaces the original. URL, MIME and preview availability fields in
responses are generated by the server and are not persisted from user input.

For the next report, re-read tasks, comments and live attachments for the
reporting period, identify actual changes, then create or edit a draft through
this API. Keep evidence distinct from plans, uploaded time distinct from work
time, and recorded status distinct from business acceptance. Refreshing source
data must not automatically overwrite human edits in an existing draft or
publication. Missing plans should remain visibly pending until their owners
provide them.

## Attachment transport contract

Authenticated media sources preserve byte identity, `Content-Length`,
`Accept-Ranges: bytes` and the exact `Content-Range` on partial responses.
`Content-Encoding: identity` prevents Django's gzip middleware from transforming
those streams; `no-transform` carries that intent through intermediaries.
This is a file transport rule shared by task, gallery and presentation previews,
not a presentation-specific PDF exception. HTML and preview UI assets retain
normal compression.

[PDF.js range capability detection](https://github.com/mozilla/pdf.js/blob/master/src/display/network_utils.js)
requires an integer content length and identity encoding before it enables
byte-range reads. [Django's gzip middleware contract](https://docs.djangoproject.com/en/5.2/ref/middleware/#gzip-middleware)
leaves responses with an explicit content encoding unchanged. Regression tests
must apply the actual gzip middleware to both full and partial source responses;
testing the source helper alone misses response transformations.
