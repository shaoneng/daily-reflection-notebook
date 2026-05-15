import { onRequestDelete as deleteDayEntry, onRequestGet as getDay, onRequestPost as saveDay } from "../functions/api/day/index.js";
import { onRequestGet as getActivity } from "../functions/api/activity/index.js";
import { onRequestGet as exportDay } from "../functions/api/export/index.js";
import { onRequestPost as reviewDay } from "../functions/api/review/index.js";
import { onRequestGet as searchNotes } from "../functions/api/search/index.js";
import { onRequestGet as listTags } from "../functions/api/tags/index.js";

const routes = {
  "GET /api/day": getDay,
  "POST /api/day": saveDay,
  "DELETE /api/day": deleteDayEntry,
  "GET /api/activity": getActivity,
  "GET /api/export": exportDay,
  "POST /api/review": reviewDay,
  "GET /api/search": searchNotes,
  "GET /api/tags": listTags,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const handler = routes[`${request.method} ${url.pathname}`];

    if (handler) {
      return handler({ request, env, ctx });
    }

    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "API route not found." }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
