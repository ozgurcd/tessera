const params = new URLSearchParams();
params.set("page_size", "50");
void fetch(`https://example.test/items?${params}`);
