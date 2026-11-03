declare const id: string;
declare const name: string;

void fetch("/api/v1/items");
void fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ name: "widget" }) });
void fetch(`/api/v1/items/${id}`, { method: "DELETE" });
void fetch("/api/setup/status");
void fetch("/api/setup/status", { method: "POST" });
void fetch("/healthz");
void fetch("/healthz", { method: "POST" });
void fetch(`/api/files/${name}`);
void fetch("/api/missing");
