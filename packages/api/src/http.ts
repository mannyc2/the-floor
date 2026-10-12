import { Health } from "@floor/contract/health";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

/** @stability unstable */
export const FloorHttpApi = HttpApi.make("Floor").add(
  HttpApiGroup.make("health").add(HttpApiEndpoint.get("get", "/api/health", { success: Health })),
);
