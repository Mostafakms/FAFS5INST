import { defineNitroPlugin } from "@agent-native/core/server";
import { startAgentNativeOtel } from "@agent-native/otel";

// The framework sends `Permissions-Policy: geolocation=()`, which makes the
// browser refuse the "My location" feature on the site map. Allow geolocation
// for this site's own pages only (camera / microphone / wake-lock unchanged).
const PERMISSIONS_POLICY =
  "camera=*, microphone=(self), geolocation=(self), screen-wake-lock=()";

export default defineNitroPlugin((nitroApp: any) => {
  startAgentNativeOtel();
  nitroApp?.hooks?.hook?.("response", (response: any) => {
    try {
      response.headers.set("Permissions-Policy", PERMISSIONS_POLICY);
    } catch {
      // headers already finalized; nothing more to do
    }
  });
});
