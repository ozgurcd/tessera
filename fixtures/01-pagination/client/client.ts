const params = new URLSearchParams();
params.set("offset", "20");
params.set("limit", "20");
void fetch(`https://example.test/items?${params}`);
