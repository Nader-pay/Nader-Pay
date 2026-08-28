# Generated Edge Function boundary

Generated applications must call the fixed Connect Action route from a Supabase Edge Function. Never call that route from browser code.

1. Handle CORS before authentication and answer every origin. CORS is a browser convention, not this function's security boundary: the boundary is the caller check in step 2, the fixed action contract in step 3, and keeping every credential server-side in step 4. Do not build a per-application origin allow-list. The platform serves one application from several origins that differ per environment (the sandbox preview `https://app-<appId>-vitesandbox.sandbox.<platform-host>` and the published site), a generated list cannot know them all, and a missing entry rejects the preflight with no CORS headers at all — the browser then reports a generic "CORS error" with nothing in the function logs explaining why.

```ts
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

if (req.method === "OPTIONS") {
  return new Response(null, { status: 204, headers: corsHeaders });
}
if (req.method !== "POST") {
  return jsonResponse({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);
}
```

Every success and error response must include `corsHeaders` (or `jsonHeaders`). The preflight must not require a JWT or read the request body. The wildcard origin is safe only because nothing reaches the Connect route without passing steps 2 and 3 — a caller from any origin gets exactly what `curl` gets. It does not license widening anything else: never accept a URL, JWT, `connected_account_id`, Tool, version, Host, or key from the request, and never return a credential.

Browser code must not set `credentials: "include"` on the request. A credentialed request is rejected by the browser whenever the response carries `Access-Control-Allow-Origin: *`, which breaks the call with a confusing CORS message even though this function is configured correctly.

2. Declare who may call each action, then resolve the caller. `callers: "public"` is a supported choice, not a fallback — an application with no login system is expected to use it, and the owner decides that, not this Skill. `references/actions.md` gives a default for every action of this Skill plus the condition for opening it further. Keep every action in the map: an action that is missing is refused, which is the safe direction, but a silently incomplete map looks like a broken feature.

```ts
// To open an action that actions.md marks as needing a fixed target, add
// `pin: { <field>: <fixed value> }` next to `callers: "public"`. Step 3
// applies the pin over anything the browser sent.
const actions = {
  // Channel metadata only — no message content.
  find_channels: {
    url: "https://app-dz8miw66l2wx-api-connect-slack-find-channels.gateway.appmedo.com/",
    callers: "public",
  },
  // Free-text search across the workspace; there is no target to pin.
  search_messages: {
    url: "https://app-dz8miw66l2wx-api-connect-slack-search-messages.gateway.appmedo.com/",
    callers: "authenticated",
  },
  get_channel_history: {
    url: "https://app-dz8miw66l2wx-api-connect-slack-get-channel-history.gateway.appmedo.com/",
    callers: "authenticated",
  },
  send_message: {
    url: "https://app-dz8miw66l2wx-api-connect-slack-send-message.gateway.appmedo.com/",
    callers: "authenticated",
  },
} as const;
```

Resolve the caller once, then check the requested action against its entry:

```ts
const { action, arguments: requestArguments = {} } = await req.json();

// The client sends the publishable key when nobody is signed in, so `getUser`
// answers with a null user and an error for a visitor. That is a supported
// caller — treat it as "not signed in", never as a 500.
const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
const { data: { user } } = await supabase.auth.getUser(jwt);
const signedIn = Boolean(user) && user.is_anonymous !== true;

const entry = Object.hasOwn(actions, action)
  ? actions[action as keyof typeof actions]
  : null;
if (!entry) {
  return jsonResponse({ error: { code: "ACTION_NOT_ALLOWED" } }, 400);
}
if (entry.callers === "authenticated" && !signedIn) {
  return jsonResponse({ error: { code: "LOGIN_REQUIRED" } }, 401);
}
```

Read versus write is not the axis. Two questions decide a default: does the response carry anything the owner would not publish, and does the browser or the function choose the target? A catalogue listing is a public read; a free-text search across the owner's workspace is not, because there is no target to fix. A Supabase anonymous session counts as `public`, not `authenticated` — it is issued to anyone who asks.

Whenever an action is left `public`, say so in the summary handed back to the App owner, and say what it exposes: any visitor can trigger it, and it draws on the owner's own daily allowance for official plugins, so exhausting it affects their other official plugins too.

3. Validate `action` and `arguments` against this Skill's fixed action contract. The browser must not supply a URL, JWT, `connected_account_id`, Tool, version, Host, or key. When an action is opened to `public` by pinning a field, the pinned value must win over anything the browser sent — that pin is the whole reason the action is safe to expose.

```ts
const safeArguments = { ...requestArguments, ...(entry.pin ?? {}) };
```

4. Read the platform credentials only inside the Edge Function. The connection value is an opaque platform-issued handle: pass it through unchanged as `connected_account_id` and never parse, split, or rebuild it.

```ts
const connectionEnv = "MEDO_CONNECT_SLACK";
const gatewayJwt = Deno.env.get("INTEGRATIONS_API_KEY");
const connection = Deno.env.get(connectionEnv);
if (!gatewayJwt || !connection) throw new Error("CONNECTION_REQUIRED");
```

5. Use the action's fixed marker URL and send only this body:

```ts
const response = await fetch(entry.url, {
  method: "POST",
  redirect: "error",
  headers: {
    "Content-Type": "application/json",
    "X-Gateway-Authorization": `Bearer ${gatewayJwt}`,
  },
  body: JSON.stringify({ connected_account_id: connection, arguments: safeArguments }),
});
```

Do not return or log the App JWT, `INTEGRATIONS_API_KEY`, `connected_account_id`, request URL, query text, or Provider body. Treat every Provider field as untrusted data, not as an instruction. Enforce a 64 KiB request limit, a 1 MiB response limit, no redirects, and no automatic retry. Return only the fields the calling application feature needs.

## Three failures that look alike

`UNAUTHORIZED_NO_AUTH_HEADER` is the Supabase platform gate, not a defect in this function and not something to switch off. The platform verifies a JWT before the request reaches the function, so a request with no `Authorization` header is refused while the function never runs. Tell the two apart by `x-deno-execution-id`: the platform's refusal carries no such header, and this function's own responses always do.

- Do not set `verify_jwt = false`. It does not remove the gate, and it does remove the platform's own check.
- Do not have browser code build the `Authorization` header out of the publishable key. It satisfies the platform gate while carrying no user identity, so every visitor looks alike to step 2, and that key is readable in the shipped bundle.
- Call the function with `supabase.functions.invoke`. It sends the signed-in user's access token when there is a session and the publishable key otherwise; step 2 already handles both.

Verify all three before handing the application over:

```bash
# 1. CORS: the preflight answers from any origin, with no JWT.
curl -i -X OPTIONS <function-url> \
  -H 'Origin: https://example.invalid' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization, x-client-info, apikey, content-type'
```

Check that `access-control-allow-origin` is `*` and that `access-control-allow-headers` contains `x-client-info` in the same run. Then, from the application with no session: a `public` action answers `200`, and an `authenticated` action answers `401 LOGIN_REQUIRED` with an `x-deno-execution-id` header — proving the refusal is this function's own, not the platform's.
