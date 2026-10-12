/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";
import type { GalleryResponse } from "../helpers/gallery";

export class GalleryService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async getGallery(workspaceSlug: string): Promise<GalleryResponse> {
    const response = await this.get(`/api/workspaces/${workspaceSlug}/gallery/`);
    return response.data as GalleryResponse;
  }
}

export const galleryService = new GalleryService();
