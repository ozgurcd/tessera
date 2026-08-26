const query = new URLSearchParams();
query.set("page", "1");
query.set("sort", "name");
void fetch(`/bind?${query}`);
