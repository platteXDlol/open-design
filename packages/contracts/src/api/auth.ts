// v7 OIDC auth: shapes shared by the daemon /api/auth/* routes, the web Account settings and `od auth`.
export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  isAdmin: boolean;
}

export interface AuthMeResponse {
  ssoEnabled: boolean;
  user: AuthUser | null;
}

export interface ApiTokenInfo {
  id: string;
  label: string;
  createdAt: number;
}

export interface ApiTokenListResponse {
  tokens: ApiTokenInfo[];
}

/** The plaintext token is returned exactly once, at creation. */
export interface ApiTokenCreateResponse {
  id: string;
  token: string;
}
