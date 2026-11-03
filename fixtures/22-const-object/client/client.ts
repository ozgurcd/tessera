import { REMOTE } from "./paths";

const LOCAL = { search: "/api/v1/search" };
let mutable = { list: "/api/v1/widgets" };

void fetch(`${LOCAL.search}?limit=5&ghost=1`);
void fetch(REMOTE.list);
void fetch(`${REMOTE.nested.show}?page=2`);
void fetch(REMOTE.list, { method: "POST", body: JSON.stringify({ name: "n", ghost_body: true }) });
void fetch(mutable.list);
