declare function idpBaseUrl(): string;

function fetchIdentityProvider(organizationId: string): void {
  const base = `${idpBaseUrl()}/api/v1/organizations/${encodeURIComponent(organizationId)}`;
  void fetch(`${base}/identity-provider`);
}

fetchIdentityProvider("org-1");
