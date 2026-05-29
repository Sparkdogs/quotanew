import http from "node:http";
import { handleRequest } from "./lib/handler.js";

const PORT = Number(process.env.PORT || 3000);

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`Quota query system running at http://localhost:${PORT}`);
});
