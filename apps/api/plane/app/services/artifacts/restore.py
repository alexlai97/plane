from django.db import transaction
from rest_framework.exceptions import PermissionDenied

from plane.db.models import Artifact, ArtifactMaterial, ArtifactSource, FileAsset, Issue
from .service import _asset, _lock_version, _source_rows, authorize_snapshot_sources, require_artifact_write


@transaction.atomic
def restore_revision(user, artifact, revision_id, version):
    artifact = Artifact.objects.select_for_update().get(pk=artifact.pk)
    _lock_version(artifact, version)
    require_artifact_write(user, artifact)
    revision = artifact.revisions.filter(id=revision_id).first()
    if revision is None:
        from rest_framework.exceptions import NotFound
        raise NotFound()
    snap = revision.snapshot
    authorize_snapshot_sources(user, artifact.workspace, snap)
    issue_ids = [s["id"] for s in snap.get("sources", [])]
    issues = _source_rows(user, artifact.workspace, issue_ids)
    assets = []
    for material in snap.get("materials", []):
        if material.get("asset_id"):
            assets.append(_asset(user, artifact.workspace, material["asset_id"], artifact))
    cover = _asset(user, artifact.workspace, snap["cover"]["asset_id"], artifact) if (snap.get("cover") or {}).get("asset_id") else None
    artifact.title = snap["title"]
    artifact.summary = snap.get("summary", "")
    artifact.kind = snap["kind"]
    artifact.category_id = snap.get("category_id")
    if artifact.category_id and not artifact.category.__class__.objects.filter(id=artifact.category_id, workspace=artifact.workspace, deleted_at__isnull=True).exists():
        from rest_framework.exceptions import ValidationError
        raise ValidationError({"category_id": "原修订分类已失效，无法恢复。"})
    artifact.cover_asset = cover
    artifact.primary_action = snap.get("primary_action", {})
    artifact.version += 1
    artifact.save()
    artifact.sources.all().delete()
    ArtifactSource.objects.bulk_create([ArtifactSource(artifact=artifact, issue=issue, project_id=issue.project_id) for issue in issues])
    artifact.materials.all().delete()
    rows = []
    for index, material in enumerate(snap.get("materials", [])):
        asset = next((a for a in assets if str(a.id) == material.get("asset_id")), None)
        rows.append(ArtifactMaterial(artifact=artifact, asset=asset, title=material["title"], url=material.get("url"), kind=material.get("kind", "reference"), position=index))
    ArtifactMaterial.objects.bulk_create(rows)
    return artifact
