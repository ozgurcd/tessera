const MUTATED = { list: "/api/old-list" };
Object.assign(MUTATED, { list: "/api/v1/list" });
const PASSED = { show: "/api/old-show" };
function repoint(table: { show: string }) { table.show = "/api/v1/show"; }
repoint(PASSED);
const STABLE = { health: "/api/v1/health" };
void Object.keys(STABLE);

void fetch(MUTATED.list);
void fetch(PASSED.show);
void fetch(STABLE.health);
