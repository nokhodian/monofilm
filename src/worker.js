// Monofilm worker. Static UI comes from ./public; only /api/* and /mcp reach this code. Every call needs a bearer token.
import { HttpError, json } from './util.js';
import { authenticate } from './auth.js';
import { authApi } from './auth-api.js';
import { api } from './api.js';
import { handleMcp, mcpPreflight, mcpUnauthorized } from './mcp.js';
import { tick } from './autopilot.js';

export default {
  async fetch(req, env, ctx) {
    try {
      if (new URL(req.url).pathname.startsWith('/api/auth/')) return await authApi(req, env); // sign up, sign in, sign out: no key needed
      const path = new URL(req.url).pathname;
      if (path === '/mcp' && req.method === 'OPTIONS') return mcpPreflight();
      const actor = await authenticate(req, env);
      if (!actor) return path === '/mcp' ? mcpUnauthorized() : json({ error: 'bearer token required' }, 401);
      if (path === '/mcp') return await handleMcp(req, env, actor);
      if (path.startsWith('/api/')) return await api(req, env, actor, ctx);
      return json({ error: 'not found' }, 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'internal error' }, 500);
    }
  },
  // Every minute: carry on any Roll camera that is running (see autopilot.js).
  async scheduled(event, env, ctx) { ctx.waitUntil(tick(env)); },
};
