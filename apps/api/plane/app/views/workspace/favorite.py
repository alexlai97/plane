# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party modules
from rest_framework import status
from rest_framework.response import Response

# Django modules
from django.db import IntegrityError

# Module imports
from plane.app.views.base import BaseAPIView
from plane.db.models import UserFavorite, Workspace
from plane.app.serializers import UserFavoriteSerializer
from plane.app.permissions import allow_permission, ROLE


class WorkspaceFavoriteEndpoint(BaseAPIView):
    use_read_replica = True

    def _serializer_context(self, request, slug):
        return {"request": request, "workspace": Workspace.objects.get(slug=slug)}

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        # Keep inaccessible personal entries visible as generic unavailable rows so they can be removed.
        favorites = UserFavorite.objects.filter(user=request.user, workspace__slug=slug, parent__isnull=True)
        serializer = UserFavoriteSerializer(favorites, many=True, context=self._serializer_context(request, slug))
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        try:
            workspace = Workspace.objects.get(slug=slug)

            # If the favorite exists return
            if request.data.get("entity_identifier"):
                user_favorites = UserFavorite.objects.filter(
                    workspace=workspace,
                    user_id=request.user.id,
                    entity_type=request.data.get("entity_type"),
                    entity_identifier=request.data.get("entity_identifier"),
                ).first()

                # If the favorite exists return
                if user_favorites:
                    serializer = UserFavoriteSerializer(
                        user_favorites, context=self._serializer_context(request, slug)
                    )
                    return Response(serializer.data, status=status.HTTP_200_OK)

            # else create a new favorite
            serializer = UserFavoriteSerializer(data=request.data, context=self._serializer_context(request, slug))
            if serializer.is_valid():
                serializer.save(
                    user_id=request.user.id,
                    workspace=workspace,
                    project_id=request.data.get("project_id", None),
                )
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response({"error": "Favorite already exists"}, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def patch(self, request, slug, favorite_id):
        favorite = UserFavorite.objects.get(user=request.user, workspace__slug=slug, pk=favorite_id)
        immutable_fields = {
            "entity_type", "entity_identifier", "is_folder", "workspace", "workspace_id",
            "project", "project_id", "user", "user_id",
        }
        changed_identity = immutable_fields.intersection(request.data)
        if changed_identity:
            return Response({field: ["This field cannot be changed."] for field in sorted(changed_identity)}, status=status.HTTP_400_BAD_REQUEST)
        serializer = UserFavoriteSerializer(
            favorite, data=request.data, partial=True, context=self._serializer_context(request, slug)
        )
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def delete(self, request, slug, favorite_id):
        favorite = UserFavorite.objects.get(user=request.user, workspace__slug=slug, pk=favorite_id)
        favorite.delete(soft=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceFavoriteGroupEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug, favorite_id):
        favorites = UserFavorite.objects.filter(user=request.user, workspace__slug=slug, parent_id=favorite_id)
        serializer = UserFavoriteSerializer(
            favorites, many=True, context={"request": request, "workspace": Workspace.objects.get(slug=slug)}
        )
        return Response(serializer.data, status=status.HTTP_200_OK)
