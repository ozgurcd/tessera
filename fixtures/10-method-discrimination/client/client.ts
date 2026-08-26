const getQuery = new URLSearchParams();
getQuery.set("page", "1");
void fetch(`/resource?${getQuery}`);

const postQuery = new URLSearchParams();
postQuery.set("page", "1");
void fetch(`/resource?${postQuery}`, { method: "POST", body: JSON.stringify({ name: "new" }) });
