const server = Bun.serve({
  port: 5173,
  fetch() {
    return Response.json({ name: 'audiobook-kit', command: 'abk', status: 'development' });
  },
});

console.log(`audiobook-kit development endpoint: ${server.url}`);
