const http = require("http");

const requestListener = (_req, res) => {
  res.writeHead(200);
  res.end("ready");
};

module.exports = () => {
  const server = http.createServer(requestListener);
  server.listen(80);
};
