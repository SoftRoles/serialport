var express = require('express')
const app = express();
var server = require('http').createServer(app);

//=========================================
// authorization check
//=========================================
function ensureLoggedIn(options) {
  if (typeof options == 'string') {
    options = { redirectTo: options }
  }
  options = options || {};

  var url = options.redirectTo || '/login';
  var setReturnTo = (options.setReturnTo === undefined) ? true : options.setReturnTo;

  return function (req, res, next) {
    var isLocal = req.ip.indexOf("127.0.0.1") > -1
    var isToken = req.headers && req.headers.authorization
      && req.headers.authorization.split(" ").length == 2
      && /^Bearer$/i.test(req.headers.authorization.split(" ")[0])
    if (!isLocal && !isToken && (!req.isAuthenticated || !req.isAuthenticated())) {
      if (setReturnTo && req.session) {
        req.session.returnTo = req.originalUrl || req.url;
      }
      return res.redirect(url);
    }
    else {
      if (isToken) {
        mongodb.db("auth").collection("users").findOne({ token: req.headers.authorization.split(" ")[1] }, function (err, user) {
          req.user = err || user || req.user || { username: "local" }
          next()
        });
      }
      else {
        req.user = req.user || { username: "local" }
        next()
      }
    }
  }
}

//=========================================
// session
//=========================================
var assert = require('assert');

var passport = require('passport');

var session = require('express-session');
var mongodbSessionStore = require('connect-mongodb-session')(session);

var mongodb;
var mongoClient = require("mongodb").MongoClient
var mongodbUrl = "mongodb://127.0.0.1:27017"
mongoClient.connect(mongodbUrl, { poolSize: 10, useNewUrlParser: true }, function (err, client) {
  assert.equal(null, err);
  mongodb = client;
});

var store = new mongodbSessionStore({
  uri: mongodbUrl,
  databaseName: 'auth',
  collection: 'sessions'
});

store.on('error', function (error) {
  assert.ifError(error);
  assert.ok(false);
});

app.use(require('express-session')({
  secret: 'This is a secret',
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
  },
  store: store,
  resave: true,
  saveUninitialized: true
}));


passport.serializeUser(function (user, cb) {
  cb(null, user.username);
});

passport.deserializeUser(function (username, cb) {
  mongodb.db("auth").collection("users").findOne({ username: username }, function (err, user) {
    if (err) return cb(err)
    if (!user) { return cb(null, false); }
    return cb(null, user);
  });
});

app.use(passport.initialize());
app.use(passport.session());


app.use(require('morgan')('tiny'));
app.use(require('body-parser').json())
app.use(require('body-parser').urlencoded({ extended: true }));
app.use(require("cors")())

//=========================================
// api
//=========================================
var io = require('socket.io')(server);
const serialPort = require('serialport')
const readline = require('@serialport/parser-readline')
const parser = new readline()
const promisify = require("util").promisify
const interval = require("interval-promise")
const uniqid = require("uniqid")
const _ = require("lodash")
var ports = []

// port write function
function portWrite(portId, buff, callback) {
  let portIndex = ports.findIndex(port => port.id == portId)
  if (portIndex > -1) {
    ports[portIndex].obj.write(buff + "\r", function (err) {
      ports[portIndex].obj.drain(function (err) {
        if (err) { callback(err, null) }
        else callback(null, {})
      })
    })
  }
  else callback("Port is not opened.")
}
const portWritePromise = promisify(portWrite)

// port delete function
function portDelete(portId, callback) {
  let portIndex = ports.findIndex(port => port.id == portId)
  if (portIndex > -1) {
    ports[portIndex].obj.close(function (err) {
      if (err) callback("Error: DEL: /serialport: " + err)
      else {
        ports[portIndex].writes.forEach(write => {
          write.stop = true
        });
        ports.splice(portIndex, 1)
        callback()
      }
    })
  }
  else callback("Port is not opened.")
}


// api
app.get('/serialport/api', ensureLoggedIn(), function (req, res) {
  serialPort.list().then(
    ports => res.send(ports),
    err => res.send(err)
  )
});

// api:port
app.get("/serialport/api/:port", ensureLoggedIn(), function (req, res) {
  let portIndex = ports.findIndex(port => port.id == req.params.port)
  if (portIndex > -1) {
    res.send(ports[portIndex].obj.isOpen)
  }
  else res.send(false)
})

app.post('/serialport/api/:port', ensureLoggedIn(), function (req, res) {
  portDelete(req.params.port, (err) => {
    new serialPort(req.params.port, {
      baudRate: parseInt(req.body.baudRate)
    }, function (err) {
      if (err) res.send({ error: err.message })
      else {
        this.pipe(parser)
        this.on("data", function (chunk) {
          io.emit(req.params.port, chunk.toString('utf8'))
        })
        ports.push({
          id: req.params.port,
          baudRate: req.params.baudRate,
          writes: [],
          obj: this
        })
        res.send({})
      }
    })
  })
});

app.put("/serialport/api/:port", function (req, res) {
  portWrite(req.params.port, req.body.buff, (err) => {
    if (!err) res.send({})
    else res.send({ error: err })
  })
})

app.delete("/serialport/api/:port", function (req, res) {
  portDelete(req.params.port, (err) => {
    if (!err) res.send({})
    else res.send({ error: err })
  })
})

// api:interval:port
app.get('/serialport/api/interval/:port', function (req, res) {
  let portIndex = ports.findIndex(port => port.id == req.params.port)
  if (portIndex > -1) {
    res.send(ports[portIndex].writes)
  }
  else res.send({ error: "Port is not opened." })
});

app.post('/serialport/api/interval/:port/:buff', function (req, res) {
  portWritePromise(req.params.port, req.params.buff)
  let portIndex = ports.findIndex(port => port.id == req.params.port)
  if (portIndex > -1) {
    let options = {
      port: req.params.port,
      buff: req.params.buff,
      interval: Number(req.body.interval) || 1000,
      stop: false
    }
    ports[portIndex].writes.push(options)
    interval(async (iteration, stop) => {
      if (options.stop) stop()
      await portWritePromise(options.port, options.buff)
    }, options.interval, { stopOnError: false })
    res.send({})
  }
  else res.send({ error: "Port is not opened." })
});

app.delete('/serialport/api/interval/:port/:buff', function (req, res) {
  let portIndex = ports.findIndex(port => port.id == req.params.port)
  if (portIndex > -1) {
    let writeIndex = ports[portIndex].writes.findIndex(write => write.buff == req.params.buff)
    if (writeIndex > -1) {
      ports[portIndex].writes[writeIndex].stop = true
      ports[portIndex].writes.splice(writeIndex, 1)
      res.send({})
    }
    else res.send({ error: "Interval write is not found." })
  }
  else res.send({ error: "Port is not open or write is not found." })
});

//=========================================
// socket
//=========================================
io.on('connection', function (socket) {
  console.log("A client is connected.");
})

server.listen(3008, function () {
  console.log("Service running on http://127.0.0.1:3008")
})