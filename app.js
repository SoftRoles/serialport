var express = require('express')
var bodyParser = require("body-parser")

const app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server);

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

//=========================================
// api
//=========================================
const serialPort = require('serialport')
const readline = require('@serialport/parser-readline')
const parser = new readline()
var serialPorts = {}

app.get('/serialport/api', function (req, res) {
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
        io.emit("data"+req.params.port, chunk.toString('utf8'))
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
        else res.send({ success: "OK" })
      })
    })
  }
  else res.send({error:"Port is not opened."})
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