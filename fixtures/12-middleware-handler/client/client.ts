void fetch("/protected", {
  method: "POST",
  body: JSON.stringify({ name: "visible to the endpoint", ghost: "not read" }),
});
