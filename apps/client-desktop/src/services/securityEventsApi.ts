import type { SecurityEventsResponse } from "@project/protocol";

import { apiRequest } from "@/services/apiClient";

export const securityEventsApi = {
  list(accessToken: string, limit = 50) {
    return apiRequest<SecurityEventsResponse>({
      path: `/security-events?limit=${limit}`,
      method: "GET",
      accessToken,
    });
  },
};
