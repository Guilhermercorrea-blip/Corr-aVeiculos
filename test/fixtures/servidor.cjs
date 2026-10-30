'use strict';
const http = require('node:http');
const original = http.createServer;
http.createServer = (...args) => {
  const server = original(...args), listen = server.listen;
  server.listen = function () { return listen.call(server, 0, '127.0.0.1', () => process.send({ port: server.address().port })); };
  return server;
};
require(process.env.SITE_TEST_ROOT + '/server');
