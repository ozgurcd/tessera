interface OrganizationInput {
  name: string;
  domain: string;
  admin_email?: string;
}

export function createOrganization(input: OrganizationInput): void {
  void fetch("/organizations", {
    method: "POST",
    body: JSON.stringify({ ...input }),
  });
}
