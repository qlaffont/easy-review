export type GithubOAuthTokens = {
    accessToken: string;
    refreshToken?: string;
    /** Seconds until the access token expires. Omitted when expiring tokens are disabled. */
    expiresIn?: number;
    /** Seconds until the refresh token expires. Omitted when expiring tokens are disabled. */
    refreshTokenExpiresIn?: number;
    tokenType?: string;
};

export function oauthTokensUseRefreshFlow(tokens: GithubOAuthTokens): boolean {
    return Boolean(tokens.refreshToken && tokens.expiresIn);
}
