declare function makeBody(): object;
const key = Math.random() > 0.5 ? "limit" : "offset";
const params = new URLSearchParams();
params.set(key, "20");
void fetch(`/computed?${params}`, { method: "POST", body: JSON.stringify(makeBody()) });
