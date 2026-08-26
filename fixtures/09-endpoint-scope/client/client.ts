const first = new URLSearchParams();
first.set("limit", "10");
void fetch(`/first?${first}`);

const second = new URLSearchParams();
second.set("limit", "10");
void fetch(`/second?${second}`);
