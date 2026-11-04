declare const base: string;
void fetch("/api/v1/things");
void fetch(`${base}/ag/api/v1/plan?limit=10&ghost=1`);
void fetch("/api/v1/plan");
