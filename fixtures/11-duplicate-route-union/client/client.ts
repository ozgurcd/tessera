void fetch("/organizations", {
  method: "POST",
  body: JSON.stringify({ name: "Acme", domain: "acme.test", admin_email: "admin@acme.test", ghost: true }),
});
