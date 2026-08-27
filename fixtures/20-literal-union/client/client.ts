function setServiceAccountState(id: string, segment: "disable" | "enable"): void {
  void fetch(`/api/v1/service-accounts/${id}/${segment}?probe=1`, { method: "POST" });
}

function useOpenUnion(id: string, segment: "disable" | number): void {
  void fetch(`/api/v1/open-service-accounts/${id}/${segment}`, { method: "POST" });
}

setServiceAccountState("service-1", "disable");
useOpenUnion("service-1", 1);
