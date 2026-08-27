const query = new URLSearchParams();
query.set("active", "true");
query.set("deleted", "false");
query.set("ghost", "intentional finding");
void fetch(`/organizations?${query}`);
