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
mongoClient.connect(mongodbUrl, { poolSize: 10 }, function (err, client) {
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
// promises
//=========================================
const promisify = require("util").promisify

function serialWriteForPromise(port, cmd, callback) {
  console.log("Here0")
  if (serialPorts[port]) {
    console.log("Here1")
    serialPorts[port].write(cmd + "\r", function (err) {
      console.log("Here2")
      serialPorts[port].drain(function (err) {
        if (err) callback("Error: POST: /serialport: " + err, "")
        else callback(null, {})
      })
    })
  }
  else callback("Port is not opened.", null)
}

const serialWritePromise = promisify(serialWriteForPromise)


//=========================================
// api
//=========================================
var io = require('socket.io')(server);
const serialPort = require('serialport')
const readline = require('@serialport/parser-readline')
const parser = new readline()
const interval = require("interval-promise")
var serialPorts = {}
var intervalWrites = []

app.get('/serialport/api', ensureLoggedIn({ redirectTo: "/403" }), function (req, res) {
  // console.log(req.user)
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

app.post('/serialport/api/interval/:port', function (req, res) {
  if (serialPorts[req.params.port]) {
    let options = intervalWrites.find(item => {
      return item.port == req.params.port && item.buff == req.body.buff
    })
    if (options) {
      Object.assign(options, { interval: req.body.interval || 1000, stop: false })
    }
    else {
      options = {
        port: req.params.port,
        buff: req.body.buff,
        interval: req.body.interval || 1000,
        stop: false
      }
    }
    intervalWrites.push(options)
    interval(async (iteration, stop) => {
      if (options.stop) stop()
      await serialWritePromise(options.port, options.buff)
    }, 3000, { stopOnError: false })
    res.send({})
  }
  else res.send({ error: "Port is not opened." })
});

app.delete('/serialport/api/interval/:port', function (req, res) {
  let options = intervalWrites.find(item => {
    return item.port == req.params.port && item.buff == req.body.buff
  })
  if (options) { options.stop = true; res.send({}) }
  else res.send({ error: "port and command poair not found" })
});


//=========================================
// socket
//=========================================
io.on('connection', function (client) {
  console.log("A client is connected.");
})


server.listen(3008, function () {
  console.log("Service running on http://127.0.0.1:3008")
})