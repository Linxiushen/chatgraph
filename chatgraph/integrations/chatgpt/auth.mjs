import { createRemoteJWKSet, jwtVerify } from 'jose';

function https(value, name) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error(`${name} 必须是不含凭证或参数的 HTTPS URL。`);
  return url.href.replace(/\/$/, '');
}

/** Resource-server verification. The configured identity provider owns login/PKCE/token issuance. */
export function createAuth(env = process.env, { keySet } = {}) {
  const issuer = env.CHATGRAPH_MCP_AUTH_ISSUER;
  const publicUrl = env.CHATGRAPH_MCP_PUBLIC_URL;
  if (!issuer) {
    if (env.CHATGRAPH_MCP_AUTH_JWKS_URL) throw new Error('配置 JWKS 时必须同时配置授权服务器 issuer。');
    return null;
  }
  if (!publicUrl || !env.CHATGRAPH_MCP_AUTH_JWKS_URL) throw new Error('OAuth 资源服务需要 PUBLIC_URL、AUTH_ISSUER 和 AUTH_JWKS_URL。');
  const resource = https(publicUrl, 'PUBLIC_URL');
  https(issuer, 'AUTH_ISSUER');
  // OAuth issuer matching is exact; a provider may include a trailing slash.
  const validIssuer = issuer;
  const jwksUrl = https(env.CHATGRAPH_MCP_AUTH_JWKS_URL, 'AUTH_JWKS_URL');
  const keys = keySet || createRemoteJWKSet(new URL(jwksUrl), { timeoutDuration: 5000, cooldownDuration: 30_000 });
  const metadataUrl = `${new URL(resource).origin}/.well-known/oauth-protected-resource`;
  const audience = env.CHATGRAPH_MCP_AUTH_AUDIENCE || resource;
  return {
    metadata: { resource, authorization_servers: [validIssuer], scopes_supported: ['chatgraph:use'], bearer_methods_supported: ['header'] },
    challenge: `Bearer resource_metadata="${metadataUrl}", error="invalid_token", error_description="A valid ChatGraph access token is required"`,
    async verify(header) {
      if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 16_384) throw new Error('缺少有效访问令牌。');
      const { payload } = await jwtVerify(header.slice(7), keys, { issuer: validIssuer, audience, algorithms: ['RS256', 'ES256'], requiredClaims: ['exp', 'iat', 'sub'], clockTolerance: 5 });
      if (typeof payload.sub !== 'string' || !payload.sub.trim()) throw new Error('访问令牌缺少用户标识。');
      const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
      if (!scopes.includes('chatgraph:use')) throw new Error('访问令牌缺少 chatgraph:use 权限。');
      return { subject: payload.sub, scopes };
    },
  };
}
