# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import User, Workspace, WorkspaceMember


class WorkspaceAppearanceAPITests(TestCase):
    def setUp(self):
        self.admin = User.objects.create(email="appearance-admin@example.com", username="appearance-admin")
        self.member = User.objects.create(email="appearance-member@example.com", username="appearance-member")
        self.outsider = User.objects.create(email="appearance-outsider@example.com", username="appearance-outsider")
        self.workspace = Workspace.objects.create(name="Appearance One", slug="appearance-one", owner=self.admin)
        self.other_workspace = Workspace.objects.create(name="Appearance Two", slug="appearance-two", owner=self.outsider)
        WorkspaceMember.objects.create(workspace=self.workspace, member=self.admin, role=20)
        WorkspaceMember.objects.create(workspace=self.workspace, member=self.member, role=15)
        WorkspaceMember.objects.create(workspace=self.other_workspace, member=self.outsider, role=20)
        self.client = APIClient()

    def url(self, slug=None):
        return f"/api/workspaces/{slug or self.workspace.slug}/"

    def test_admin_can_read_update_merge_and_clear_appearance(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get(self.url())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["appearance"], {})

        response = self.client.patch(
            self.url(),
            {"appearance": {"theme": "blue-gray", "organization_logo_url": "/bokang-logo.png"}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["appearance"], {"theme": "blue-gray", "organization_logo_url": "/bokang-logo.png"})

        response = self.client.patch(self.url(), {"appearance": {"theme": None}}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["appearance"], {"theme": None, "organization_logo_url": "/bokang-logo.png"})

        response = self.client.patch(self.url(), {"appearance": {}}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["appearance"], {"theme": None, "organization_logo_url": "/bokang-logo.png"})

        response = self.client.patch(
            self.url(), {"appearance": {"organization_logo_url": None}}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["appearance"], {"theme": None, "organization_logo_url": None})

        response = self.client.patch(self.url(), {"appearance": None}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.appearance, {})

    def test_members_cannot_update_and_cannot_access_another_workspace(self):
        self.client.force_authenticate(user=self.member)
        response = self.client.patch(self.url(), {"appearance": {"theme": "blue-gray"}}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.outsider)
        response = self.client.get(self.url())
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        response = self.client.patch(self.url(), {"appearance": {"theme": "blue-gray"}}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.appearance, {})

    def test_appearance_is_isolated_per_workspace(self):
        self.workspace.appearance = {"theme": "blue-gray"}
        self.workspace.save(update_fields=["appearance"])
        self.assertEqual(self.other_workspace.appearance, {})

    def test_invalid_appearance_is_rejected_without_mutation(self):
        self.client.force_authenticate(user=self.admin)
        invalid_values = [
            [],
            {"theme": "unknown"},
            {"extra": True},
            {"organization_logo_url": "javascript:alert(1)"},
            {"organization_logo_url": "//evil.example/logo.png"},
            {"organization_logo_url": "/logo.png\n"},
            {"organization_logo_url": "https://bad host/logo.png"},
        ]
        for appearance in invalid_values:
            with self.subTest(appearance=appearance):
                response = self.client.patch(self.url(), {"appearance": appearance}, format="json")
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.workspace.refresh_from_db()
                self.assertEqual(self.workspace.appearance, {})
