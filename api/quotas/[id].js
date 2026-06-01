import { handleRequest } from "../../lib/handler.js";

export default async function handler(req, res) {
  await handleRequest(req, res);
}
