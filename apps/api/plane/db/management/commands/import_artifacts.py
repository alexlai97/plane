"""Explicit, idempotent import for the archived legacy gallery manifest."""
import json
import uuid
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from plane.db.models import Artifact, ArtifactCategory, ArtifactMaterial, ArtifactRevision, ArtifactSource, FileAsset, Issue, User, Workspace
from plane.app.services.artifacts.service import snapshot as artifact_snapshot


class Command(BaseCommand):
    help = "Import archived gallery cards into normalized artifacts. Defaults to dry-run."

    def add_arguments(self, parser):
        parser.add_argument("--workspace", required=True)
        parser.add_argument("--owner", required=True, help="Artifact attribution owner by UUID or active user email")
        parser.add_argument("--input", default=str(Path(__file__).resolve().parents[2] / "app" / "data" / "archive" / "gallery.json"))
        parser.add_argument("--apply", action="store_true", help="Write validated imports (default is dry-run).")

    def handle(self, *args, **options):
        try:
            workspace = Workspace.objects.filter(slug=options["workspace"], deleted_at__isnull=True).first()
            if workspace is None:
                workspace = Workspace.objects.get(id=options["workspace"], deleted_at__isnull=True)
            owner_key = options["owner"]
            owner = User.objects.filter(email__iexact=owner_key, is_active=True).first()
            if owner is None:
                owner = User.objects.get(id=owner_key, is_active=True)
            manifest = json.loads(Path(options["input"]).read_text(encoding="utf-8"))
        except Exception as exc:
            raise CommandError(f"Could not load import inputs: {exc}")
        if str(manifest.get("workspace_id")) != str(workspace.id):
            raise CommandError("Input workspace_id does not match --workspace")
        if not isinstance(manifest.get("cards"), list):
            raise CommandError("Input cards must be a list")
        ns = uuid.UUID(str(workspace.id))
        actions = []
        for card in manifest["cards"]:
            artifact_id = uuid.uuid5(ns, str(card["key"]))
            current = Artifact.objects.filter(id=artifact_id).first()
            try:
                category_name = card.get("category")
                category = ArtifactCategory.objects.filter(workspace=workspace, name=category_name, deleted_at__isnull=True).first() if category_name else None
                issue_ids = list(card.get("sources", []))
                issues = list(Issue.issue_objects.filter(id__in=issue_ids, workspace=workspace, deleted_at__isnull=True).select_related("project"))
                if len(issues) != len(set(issue_ids)):
                    raise ValueError("one or more source issues are missing or outside the workspace")
                issues_by_id = {str(issue.id): issue for issue in issues}
                issues = [issues_by_id[str(issue_id)] for issue_id in issue_ids]
                assets = []
                for entry in card.get("assets", []):
                    asset = FileAsset.objects.filter(id=entry["id"], workspace=workspace, is_uploaded=True, is_deleted=False, deleted_at__isnull=True).first()
                    if asset is None or asset.entity_type != entry.get("entity_type"):
                        raise ValueError(f"legacy asset {entry.get('id')} is missing or changed")
                    if not any(asset.issue_id == issue.id or (asset.comment_id and asset.comment.issue_id == issue.id) for issue in issues):
                        raise ValueError(f"legacy asset {asset.id} is not attached to a declared source")
                    assets.append(asset)
                cover_id = card.get("cover_asset_id")
                if cover_id:
                    cover = FileAsset.objects.filter(id=cover_id, workspace=workspace, is_uploaded=True, is_deleted=False, deleted_at__isnull=True).first()
                    if cover is None:
                        raise ValueError(f"legacy cover {cover_id} is missing")
                    if not any(str(asset.id) == str(cover_id) for asset in assets):
                        raise ValueError(f"legacy cover {cover_id} is not among validated card assets")
                for link in card.get("links", []):
                    from urllib.parse import urlparse
                    parsed = urlparse(link.get("url", ""))
                    if parsed.scheme not in ("http", "https") or not parsed.netloc:
                        raise ValueError("unsafe legacy link")
                if current:
                    current_category = current.category.name if current.category_id else None
                    current_assets = set(current.materials.filter(asset__isnull=False).values_list("asset_id", flat=True))
                    expected_assets = {uuid.UUID(str(item["id"])) for item in card.get("assets", [])}
                    current_links = set(current.materials.filter(url__isnull=False).values_list("title", "url", "kind"))
                    expected_links = {(item["title"], item["url"], item.get("kind", "reference")) for item in card.get("links", [])}
                    current_sources = set(current.sources.exclude(issue__isnull=True).values_list("issue_id", flat=True))
                    expected_sources = {uuid.UUID(str(issue_id)) for issue_id in issue_ids}
                    identical = (
                        current.workspace_id == workspace.id and current.title == card.get("title")
                        and current.access == Artifact.Access.WORKSPACE
                        and current.status == Artifact.Status.PUBLISHED
                        and current.published_revision_id is not None
                        and current.summary == card.get("summary", "") and current.kind == card.get("kind")
                        and current_category == category_name and current_assets == expected_assets and current_links == expected_links
                        and current_sources == expected_sources and current.primary_action == card.get("primary_action", {"type": "detail", "label": "查看详情"})
                        and str(current.cover_asset_id) == str(card.get("cover_asset_id"))
                    )
                    if not identical:
                        raise ValueError("deterministic ID exists with different data; refusing to overwrite")
                    actions.append((card["key"], "skip", "already imported"))
                else:
                    actions.append((card["key"], "create", "validated"))
            except Exception as exc:
                actions.append((card.get("key", "?"), "error", str(exc)))
        for key, action, reason in actions:
            self.stdout.write(f"{action}: {key} ({reason})")
        errors = [a for a in actions if a[1] == "error"]
        if errors:
            if options["apply"]:
                raise CommandError("Import validation failed; no changes were written")
            return
        if not options["apply"]:
            self.stdout.write(f"Dry run complete: {sum(a[1] == 'create' for a in actions)} create, {sum(a[1] == 'skip' for a in actions)} skip")
            return
        with transaction.atomic():
            # Repeat validation inside the write transaction and never overwrite an existing row.
            for card in manifest["cards"]:
                artifact_id = uuid.uuid5(ns, str(card["key"]))
                if Artifact.objects.filter(id=artifact_id).exists():
                    continue
                category_name = card.get("category")
                category = None
                if category_name:
                    category, _ = ArtifactCategory.objects.get_or_create(workspace=workspace, name=category_name, defaults={"version": 1})
                issues = list(Issue.issue_objects.filter(id__in=card.get("sources", []), workspace=workspace, deleted_at__isnull=True).select_related("project"))
                assets = [FileAsset.objects.get(id=item["id"], workspace=workspace, is_uploaded=True, is_deleted=False, deleted_at__isnull=True) for item in card.get("assets", [])]
                if len(issues) != len(set(card.get("sources", []))):
                    raise CommandError("Source references changed since validation")
                issues_by_id = {str(issue.id): issue for issue in issues}
                issues = [issues_by_id[str(issue_id)] for issue_id in card.get("sources", [])]
                cover = FileAsset.objects.get(id=card["cover_asset_id"], workspace=workspace, is_uploaded=True, is_deleted=False, deleted_at__isnull=True) if card.get("cover_asset_id") else None
                artifact = Artifact(id=artifact_id, workspace=workspace, owner=owner, access=Artifact.Access.WORKSPACE, title=card["title"], summary=card.get("summary", ""), kind=card["kind"], category=category, cover_asset=cover,
                                    primary_action=card.get("primary_action", {"type": "detail", "label": "查看详情"}), status=Artifact.Status.PUBLISHED)
                artifact.save(force_insert=True)
                ArtifactSource.objects.bulk_create([ArtifactSource(artifact=artifact, issue=issue) for issue in issues])
                links = card.get("links", [])
                ArtifactMaterial.objects.bulk_create(
                    [ArtifactMaterial(artifact=artifact, asset=asset, title=asset.attributes.get("name", "附件"), kind="attachment", position=i) for i, asset in enumerate(assets)] +
                    [ArtifactMaterial(artifact=artifact, title=link["title"], url=link["url"], kind=link.get("kind", "reference"), position=len(assets)+i) for i, link in enumerate(links)]
                )
                revision = ArtifactRevision.objects.create(artifact=artifact, number=1, snapshot=artifact_snapshot(artifact, workspace.slug), actor=owner)
                artifact.published_revision = revision
                artifact.save(update_fields=["published_revision"])
        self.stdout.write(self.style.SUCCESS(f"Imported {sum(a[1] == 'create' for a in actions)} artifacts; skipped {sum(a[1] == 'skip' for a in actions)}"))
