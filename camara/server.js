var app = require("express")();
var http = require("http").Server(app);
var io = require("socket.io")(http);
var SonyCamera = require("../index.js");
var cors = require("cors");

var cam = new SonyCamera();

io.origins("http://localhost:3000");

cam.on("update", (param, value) => {
  io.emit("update", param, value);
});

let currentFrame = 0;
cam.on("liveviewJpeg", (frameNumber, image) => {
  if (currentFrame > frameNumber) {
    return;
  }
  if (image) {
    io.emit("image", image.toString("base64"));
  }
});

cam.connect();

io.on("connection", function(socket) {
  io.emit("params", cam.params);
  socket.on("capture", function() {
    cam.capture(true, function(err, name, image) {
      if (err) {
        return io.emit("status", "Error: " + err);
      }
      if (image) io.emit("image", image.toString("base64"));
      if (name && !image) io.emit("status", "new photo: " + name);
    });
  });
  socket.on("startViewfinder", function() {
    console.log("starting liveview");
    cam.startViewfinder();
  });
  socket.on("stopViewfinder", function() {
    cam.stopViewfinder();
  });
  socket.on("set", function(param, value) {
    cam.set(param, value);
  });
  socket.on('zoomIn', () => {
    // cam.zoomIn();
    cam.getServerInfo()
  })
});

app.use(
  cors({
    origin: false,
    credentials: false
  })
);
http.listen(3001, function() {
  console.log("listening on *:3001");
});

// app.use(function(req, res, next) {
// 	res.header("Access-Control-Allow-Origin", "*");
// 	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

//    // Add this
//    if (req.method === 'OPTIONS') {

// 		res.header('Access-Control-Allow-Methods', 'PUT, POST, PATCH, DELETE, OPTIONS');
// 		res.header('Access-Control-Max-Age', 120);
// 		return res.status(200).json({});
// 	}

// 	next();

//   });
