void fetch("/nested", {
  method: "POST",
  body: JSON.stringify({ name: "outer", ghost: "nested-only" }),
});
