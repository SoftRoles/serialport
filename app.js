var express = require('express')
var bodyParser = require("body-parser")
var cors = require("cors")
var path = require('path');
var serial = require('serialport');

const app = express();
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(cors())
app.use(express.static(__dirname + "/www"))

app.listen(5003, function () {
  console.log('App listening on port 5003!')
})

app.get("/", function (req, res) {
  res.send("index.html")
})

var serialPorts = {}
var serialBuffs = {}

app.get("/serialport", function (req, res) {
  serial.list(function (err, ports) {
    res.send(ports)
  })
})

app.post("/serialport/:port", function (req, res) {
  if (serialPorts[req.params.port]) {
    serialPorts[req.params.port].close(function (err) {
      if (err) res.send({ error: err })
      else {
        serialPorts[req.params.port] = new serial(req.params.port, {
          // parser: serial.parsers.readline('-->'),
          parser: serial.parsers.readline(),
          baudRate: parseInt(req.body.baud)
        }, function (err) {
          if (err) {
            res.send({ error: err.message });
          }
          else {
            serialBuffs[req.params.port] = ["", "", "", ""]
            serialPorts[req.params.port].on('data', function (data) {
              serialBuffs[req.params.port].push(data); serialBuffs[req.params.port].shift();
            });
            res.send({ success: "OK" })
          }
        })
      }
    })
  }
  else {
    serialPorts[req.params.port] = new serial(req.params.port, {
      parser: serial.parsers.readline('-->'),
      baudRate: parseInt(req.body.baud)
      , function(err) {
        if (err) {
          res.send({ error: err.message });
        }
        else {
          serialBuffs[req.params.port] = ["", "", "", ""]
          serialPorts[req.params.port].on('data', function (data) {
            serialBuffs[req.params.port].push(data); serialBuffs[req.params.port].shift();
          });
          res.send({ success: "OK" })
        }
      }
    })
  }
})

app.put("/serialport/:port", function (req, res) {
  serialPorts[req.params.port].write(req.body.buff + "\r", function (err) {
    serialPorts[req.params.port].drain(function (err) {
      if (err) { res.send({ error: "Error: POST: /serialport: " + err }) }
      else res.send({ success: "OK", buff: serialBuffs[req.params.port] })
    })
  })
})

app.get("/serialport/:port", function (req, res) {
  res.send({ buff: serialBuffs[req.params.port] })
})

app.delete("/serialport/:port", function (req, res) {
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