var express = require('express')
var bodyParser = require("body-parser")

const app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server);
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(express.static(__dirname + '/node_modules'));
app.use(express.static(__dirname + '/public'));

app.get('/', function (req, res, next) {
  res.sendFile("index.html");
});

io.on('connection', function (client) {
  console.log('Client connected...');

  client.on('join', function (data) {
    console.log(data);
    client.on('messages', function (data) {
      client.emit('broad', data);
      client.broadcast.emit('broad', data);
    });
  });
})

server.listen(3008, function () {
  console.log("Service running on http://127.0.0.1:3008")
})