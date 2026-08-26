function addMemberFilter(target: URLSearchParams): void {
  target.append("member", "active");
}

const query = new URLSearchParams();
addMemberFilter(query);
const baseUrl = "https://example.test";
const organizationId = "org-1";
void fetch(`${baseUrl}/organizations/${organizationId}/members?${query}`);
