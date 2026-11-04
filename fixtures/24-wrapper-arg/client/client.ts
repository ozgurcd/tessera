declare const BASE: string;
function agFetch(base: string, route: string, init?: RequestInit) { return fetch(base + route, init); }

void agFetch(BASE, "/api/v1/things?limit=10&ghost=1");
void agFetch(BASE, "/api/v1/things", { method: "POST", body: JSON.stringify({ name: "widget", ghost_body: true }) });
