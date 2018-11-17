var express = require('express')
var bodyParser = require("body-parser")
var assert = require("assert")

const app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server);

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

var mongodb;
var mongoClient = require("mongodb").MongoClient
var mongodbUrl = "mongodb://127.0.0.1:27017"
mongoClient.connect(mongodbUrl, { poolSize: 10 }, function (err, client) {
  assert.equal(null, err);
  mongodb = client;
});


var passport = require('passport')
var customStrategy = require('passport-custom').Strategy
passport.use(new customStrategy(function (req, cb) {
  const isLocalUser = req.ip.indexOf("127.0.0.1") > -1
  if (req.headers &&
    req.headers.authorization &&
    req.authorization.split(" ").length == 2 &&
    /^Bearer$/i.test(req.authorization.split(" ")[0])) {
    mongodb.db("auth").collection("users").findOne({ token: req.authorization.split(" ")[1] }, function (err, user) {
      if (err) return cb(err)
      if (!user) { return cb(null, false); }
      return cb(null, user);
    });
  }
  else {
    return cb(null, isLocalUser ? { username: "guest" } : false)
  }
}));
//=========================================
// api
//=========================================
const serialPort = require('serialport')
const readline = require('@serialport/parser-readline')
const parser = new readline()
var serialPorts = {}

app.get('/serialport/api', passport.authenticate("custom", { session: false, failureRedirect:"/403" }), function (req, res) {
  console.log(req.user)
  serialPort.list().then(
    ports => res.send(ports),
    err => res.send(err)
  )
});

app.post('/serialport/api/:port', function (req, res) {
  if (serialPorts[req.params.port]) {
    serialPorts[req.params.port].close(function (err) {
      if (err) res.send({ error: err })
      delete serialPorts[req.params.port]
    })
  }
  serialPorts[req.params.port] = new serialPort(req.params.port, {
    baudRate: parseInt(req.body.baudRate)
  }, function (err) {
    if (err) res.send({ error: err.message })
    else {
      serialPorts[req.params.port].pipe(parser)
      serialPorts[req.params.port].on("data", function (chunk) {
        console.log(chunk.toString('utf8'))
        io.emit("data" + req.params.port, chunk.toString('utf8'))
      })
      res.send({})
    }
  })
});

app.put("/serialport/api/:port", function (req, res) {
  if (serialPorts[req.params.port]) {
    serialPorts[req.params.port].write(req.body.buff + "\r", function (err) {
      serialPorts[req.params.port].drain(function (err) {
        if (err) { res.send({ error: "Error: POST: /serialport: " + err }) }
        else res.send({})
      })
    })
  }
  else res.send({ error: "Port is not opened." })
})

app.delete("/serialport/api/:port", function (req, res) {
  if (serialPorts[req.params.port]) {
    serialPorts[req.params.port].close(function (err) {
      if (err) res.send({ error: "Error: DEL: /serialport: " + err })
      else {
        delete serialPorts[req.params.port]
        res.send({ success: "OK" })
      }
    })
  }
  else {
    res.send({ error: "Port is not open." })
  }
})

io.on('connection', function (client) {
  console.log("A client is connected.");
})


server.listen(3008, function () {
  console.log("Service running on http://127.0.0.1:3008")
})