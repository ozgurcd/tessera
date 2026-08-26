type Options = { name: string; domain: string; adminEmail?: string; scope?: string };

export function createOrganization(options: Options): void {
  const body: Record<string, unknown> = {
    name: options.name,
    domain: options.domain,
  };
  if (options.adminEmail) body.admin_email = options.adminEmail;
  if (options.scope) body["scope"] = options.scope;
  void fetch("/organizations", { method: "POST", body: JSON.stringify(body) });
}
