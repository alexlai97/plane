# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import serializers

from plane.db.models import UserFavorite
from plane.app.services.favorites import favorite_target_is_allowed, resolve_favorite_targets


class UserFavoriteListSerializer(serializers.ListSerializer):
    def to_representation(self, data):
        items = list(data)
        resolution = resolve_favorite_targets(items, self.context["request"].user) if items else {}
        self.child._favorite_resolution = resolution
        return super().to_representation(items)


class UserFavoriteSerializer(serializers.ModelSerializer):
    entity_data = serializers.SerializerMethodField()
    is_available = serializers.SerializerMethodField()
    project_id = serializers.UUIDField(required=False, allow_null=True)

    class Meta:
        model = UserFavorite
        fields = [
            "id",
            "entity_type",
            "entity_identifier",
            "entity_data",
            "is_available",
            "name",
            "is_folder",
            "sequence",
            "parent",
            "workspace_id",
            "project_id",
        ]
        read_only_fields = ["workspace", "workspace_id", "project", "user", "created_by", "updated_by"]
        list_serializer_class = UserFavoriteListSerializer

    def get_entity_data(self, obj):
        resolution = self._resolution_for(obj)
        return resolution.get(obj.id, {}).get("entity_data")

    def get_is_available(self, obj):
        return self._resolution_for(obj).get(obj.id, {}).get("is_available", False)

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        if instance.is_folder:
            representation["name"] = instance.name
        elif representation.get("is_available"):
            representation["name"] = representation["entity_data"].get("name")
        else:
            representation["name"] = None
        return representation

    def _resolution_for(self, obj):
        resolution = getattr(self, "_favorite_resolution", None)
        if resolution is None:
            resolution = resolve_favorite_targets([obj], self.context["request"].user)
            self._favorite_resolution = resolution
        return resolution

    def validate(self, attrs):
        user = self.context["request"].user
        workspace = self.context["workspace"]
        parent = attrs.get("parent", getattr(self.instance, "parent", None))
        if parent and (
            parent.user_id != user.id or parent.workspace_id != workspace.id
            or not parent.is_folder or parent.parent_id is not None
        ):
            raise serializers.ValidationError({"parent": "Choose a folder in this workspace that belongs to you."})

        is_folder = attrs.get("is_folder", getattr(self.instance, "is_folder", False))
        entity_type = attrs.get("entity_type", getattr(self.instance, "entity_type", None))
        if is_folder:
            if entity_type != "folder":
                raise serializers.ValidationError({"entity_type": "A folder must use the folder entity type."})
            if parent:
                raise serializers.ValidationError({"parent": "Folders cannot be nested."})
            if attrs.get("entity_identifier", getattr(self.instance, "entity_identifier", None)):
                raise serializers.ValidationError({"entity_identifier": "Folders cannot reference an entity."})
            return attrs
        if entity_type == "folder":
            raise serializers.ValidationError({"is_folder": "Folder entities must be marked as folders."})

        identifier = attrs.get("entity_identifier", getattr(self.instance, "entity_identifier", None))
        project_id = attrs.get("project_id", getattr(self.instance, "project_id", None))
        if self.instance and set(attrs).issubset({"sequence"}):
            # Personal ordering must remain usable for stale or newly private references.
            return attrs
        if not favorite_target_is_allowed(user, workspace, entity_type, identifier, project_id):
            raise serializers.ValidationError({"entity_identifier": "The selected item is unavailable or you cannot access it."})
        return attrs
