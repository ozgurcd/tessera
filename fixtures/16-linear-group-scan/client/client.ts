void fetch("/api/large", {
  method: "POST",
  body: JSON.stringify({ known: true, ghost: true }),
});
