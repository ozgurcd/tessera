const first = new URLSearchParams();
first.set("known", "yes");
void fetch(`/first/one?${first}`);

const second = new URLSearchParams();
second.set("known", "yes");
void fetch(`/second/two?${second}`);

const after = new URLSearchParams();
after.set("known", "yes");
void fetch(`/first/after?${after}`);

const third = new URLSearchParams();
third.set("known", "yes");
void fetch(`/third/three?${third}`);
