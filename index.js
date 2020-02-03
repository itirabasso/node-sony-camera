var fs = require("fs");
var url = require("url");
var http = require("http");
var semver = require("semver");
var util = require("util");
var EventEmitter = require("events").EventEmitter;
var assert = require("assert");
const needle = require('needle');

var minVersionRequired = "2.1.4";

// (function () {

const SonyCamera = function(url, port, path) {
  console.log("initializing", url, port, path);
  this.url = url || "192.168.122.1";
  this.port = port || 8080;
  this.path = path || "/sony/camera";
  this.method = "old";

  this.rpcReq = {
    id: 1,
    version: "1.0"
  };

  this.params = {};
  this.status = "UNKNOWN";

  this.connected = false;
  this.ready = false;
  this.availableApiList = [];
};

util.inherits(SonyCamera, EventEmitter);

SonyCamera.prototype.show = function() {
  console.log(this.url + ":" + this.port + this.path);
};

SonyCamera.prototype.call = function(method, params, callback) {
  var self = this;
  this.rpcReq.method = method;
  this.rpcReq.params = params || [];
  if (this.version !== undefined) {
    console.log("version:", this.version);
    this.rpcReq.version = this.version;
  }
  var postData = JSON.stringify(this.rpcReq);

  var timeoutHandle = null;
  function processResponse(res) {
    //console.log(res);
    let rawData = "";
    let parsedData = null;
    res.setEncoding("utf8");
    res.on("data", function(chunk) {
      rawData += chunk;
    });
    res.on("end", () => {
      clearTimeout(timeoutHandle);
      try {
        parsedData = JSON.parse(rawData);
        var result = parsedData ? parsedData.result : null;
        var error = parsedData ? parsedData.error : null;
        if (error) {
          if (error.length > 0 && error[0] == 1 && method == "getEvent") {
            setTimeout(function() {
              self.call(method, params, callback);
            });
            return;
          }
          console.log("SonyWifi: error during request", method, error);
        }
        //console.log("completed", error, result);
        callback && callback(error, result);
      } catch (e) {
        console.log(e.message);
        callback && callback(e);
      }
    });
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: "POST",
        data: postData,
        hostname: this.url,
        port: this.port,
        path: this.path,
        timeout: 2000,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(postData)
        }
      },
      processResponse
    );
    req.on("error", err => {
      console.log("requst error", err);
      if (err && err.code) {
        console.log("SonyWifi: network appears to be disconnected");
        self.emit("disconnected");
      }
      reject(err);
    });

  })


  timeoutHandle = setTimeout(function() {
    req.abort();
    console.log("SonyWifi: network appears to be disconnected");
    self.emit("disconnected");
  }, 30000);

  req.write(postData);
  req.end();
};

SonyCamera.prototype.getParam = function(name) {
  return this.params[name] ? this.params[name].current : undefined;
};
SonyCamera.prototype.setParam = function(name, newValue, candidates) {
  // console.log("Updating", name, newValue, candidates.length);
  if (this.params[name] === undefined) {
    this.params[name] = {};
  }
  if (newValue !== undefined) {
    this.params[name].current = newValue;
  }
  if (candidates !== undefined) {
    this.params[name].available = candidates;
  }
};

SonyCamera.prototype._processEvents = function(waitForChange, callback) {
  this.eventPending = true;
  this.call("getEvent", [waitForChange || false], (err, results) => {
    this.eventPending = false;
    // console.log(err);
    if (!err) {
      // console.log(results);
      for (var i = 0; i < results.length; i++) {
        let item = results[i];
        console.log("Item", i);
        console.log(item);

        if (item instanceof Array) {
          if (item.length > 0) {
            item = {
              type: item[0].type,
              items: item
            };
          } else {
            continue;
          }
        }

        if (!item || (Array.isArray(item) && item.length === 0)) {
          continue;
        }

        const { type } = item;
        // console.log("xxxx", item, type);
        switch (type) {
          case "cameraStatus":
            console.log("Incoming camera status event");
            this.status = item.cameraStatus;
            switch (this.status) {
              case "NotReady":
                this.connected = false;
                console.log("SonyWifi: disconnected, trying to reconnect");
                setTimeout(function() {
                  this.connect();
                }, 2500);
                break;
              case "IDLE":
                this.ready = true;
                break;
              default:
                this.ready = false;
            }
            this.emit("status", item.cameraStatus);
            console.log("SonyWifi: status", this.status);
            break;
          case "zoomInformation":
            break;
          case "liveviewStatus":
            break;
          case "liveviewOrientation":
            break;
          case "takePicture":
            break;

          case "storageInformation":
            this.photosRemaining = item.items
              .filter(media => media.recordTarget)
              .map(media => media.numberOfRecordableImages || 0)
              .reduce((acc, amount) => acc + amount);
            break;

          case "availableApiList":
            this.availableApiList = item.names || [];
            break;
          default:
            const getEventData = () => {
              // console.log("itemx", i, type);
              const currentKey =
                "current" + type.charAt(0).toUpperCase() + type.slice(1);
              return {
                candidates: item[item.type + "Candidates"] || [],
                current: item[currentKey],
                type: type
              };
            };
            const emitParamUpdate = name => {
              this.emit("update", name, this.params[name]);
            };
            const previousValue = this.getParam(type);
            const { candidates, current } = getEventData();
            this.setParam(type, current, candidates);
            if (previousValue !== current) {
              console.log(
                "SonyWifi: %s = %s (+ %d available)",
                type,
                current,
                candidates.length
              );
              emitParamUpdate(type);
            }
        }
      }
    }

    if (callback) {
      callback(err);
    }
  });
};

SonyCamera.prototype.connect = function(callback) {
  // var self = this;
  if (this.connecting) {
    return callback && callback("Already trying to connect");
  }
  this.connecting = true;
  console.log("Connecting...")
  try {
    const version = await this.getAppVersion();
    console.log("Application version: %s", version);
    if (!semver.gte(version, minVersionRequired)) {
      throw new Error("Application version if not compatible");
    }
    const afterConnected = () => {
      this.connected = true;

    }
    this.version = version;
  } catch (error) {
    this.connecting = false;
    callback && callback(err);
  }
  this.getAppVersion((err, version) => {
    if (!err && version) {
      if (semver.gte(version, minVersionRequired)) {
        self.version = version;
        var connected = function() {
          self.connected = true;
          var _checkEvents = function(err) {
            if (!err) {
              if (self.connected) self._processEvents(true, _checkEvents);
              else console.log("SonyWifi: disconnected, stopping event poll");
            } else {
              setTimeout(_checkEvents, 5000);
            }
          };
          self._processEvents(false, function() {
            self.connecting = false;
            callback && callback(err);
            _checkEvents();
          });
        };
        if (self.method == "old") {
          self.call("startRecMode", null, function(err) {
            if (!err && !self.connected) {
              youtub();
            } else {
              self.connecting = false;
              callback && callback(err);
            }
          });
        } else {
          connected();
        }
      } else {
        callback({
          err: "APPVERSION",
          message:
            "Could not connect to camera -- remote control application must be updated (currently installed: " +
            version +
            ", should be " +
            minVersionRequired +
            " or newer)"
        });
      }
    } else {
      self.connecting = false;
      callback && callback(err);
    }
  });
};

SonyCamera.prototype.disconnect = function(callback) {
  this.call("stopRecMode", null, function(err) {
    if (!err) {
      this.connected = false;
    }
    callback && callback(err);
  });
};

SonyCamera.prototype.startViewfinder = function(req, res) {
  var self = this;
  this.call("startLiveview", null, function(err, output) {
    console.log(output);
    const liveviewUrl = url.parse(output[0]);
    //console.log(liveviewUrl);

    const COMMON_HEADER_SIZE = 8;
    const PAYLOAD_HEADER_SIZE = 128;
    const JPEG_SIZE_POSITION = 4;
    const PADDING_SIZE_POSITION = 7;
    const FRAME_NUMBER_POSITION = 2;

    var jpegSize = 0;
    var paddingSize = 0;
    var bufferIndex = 0;

    function processFrame(liveview) {
      const { statusCode } = liveview;

      if (statusCode !== 200) {
        console.log("status code:", statusCode);
      }
      var imageBuffer;

      var buffer = Buffer.alloc ? Buffer.alloc(0) : new Buffer(0);
      let frameNumber = 0;

      liveview.on("data", function(chunk) {
        if (jpegSize === 0) {
          // console.log("Incoming new frame");
          buffer = Buffer.concat([buffer, chunk]);

          if (buffer.length < COMMON_HEADER_SIZE + PAYLOAD_HEADER_SIZE) {
            return;
          }

          const startByte = buffer.readUIntBE(0, 1);
          const payloadType = buffer.readUIntBE(1, 1);
          if (startByte !== 0xff) {
            console.log("skipping until next packet");
            const pos = buffer.indexOf("24356879", 0, "hex");
            console.log(pos);
            buffer = buffer.slice(pos - 8);
            console.log(buffer.subarray(0, 20));
          }
          // const fixedBytes = buffer.readUIntBE(8, 1);
          // console.log("startByte", startByte);
          // console.log("payloadType", payloadType);
          // console.log("fixedBytes", fixedBytes);
          // assert(startByte === 0xff, "invalid start byte");
          // assert(payloadType === 0x01, "invalid payload type");
          // const payloadFixedBytes = [0, 1, 2, 3].map(i =>
          //   buffer.readUInt8(8 + i)
          // );
          // assert(
          //   payloadFixedBytes[0] === 0x24 &&
          //     payloadFixedBytes[1] === 0x35 &&
          //     payloadFixedBytes[2] === 0x68 &&
          //     payloadFixedBytes[3] === 0x79,
          //   "invalid fixes bytes => " + payloadFixedBytes
          // );
          // assert(
          //   buffer.length >= COMMON_HEADER_SIZE + PAYLOAD_HEADER_SIZE,
          //   "invalid packet header size"
          // );

          jpegSize =
            buffer.readUInt8(COMMON_HEADER_SIZE + JPEG_SIZE_POSITION) * 65536 +
            buffer.readUInt16BE(COMMON_HEADER_SIZE + JPEG_SIZE_POSITION + 1);

          frameNumber = buffer.readUInt16BE(FRAME_NUMBER_POSITION);
          console.log(
            "new frame",
            frameNumber,
            jpegSize,
            (jpegSize / (1024 * 1024)).toString().substr(0, 4),
            "MB"
          );

          imageBuffer = Buffer.alloc
            ? Buffer.alloc(jpegSize)
            : new Buffer(jpegSize);

          paddingSize = buffer.readUInt8(
            COMMON_HEADER_SIZE + PADDING_SIZE_POSITION
          );
          // console.log("padding size", paddingSize);

          // skip common header and payload header
          buffer = buffer.slice(8 + 128);

          // the buffer now should contain the first part of a JPEG image
          // TODO : check jpeg header?
          if (buffer.length > 0) {
            buffer.copy(imageBuffer, bufferIndex, 0, buffer.length);
            bufferIndex += buffer.length;
          }
        } else {
          chunk.copy(imageBuffer, bufferIndex, 0, chunk.length);
          bufferIndex += chunk.length;

          if (chunk.length < jpegSize) {
            jpegSize -= chunk.length;
            assert(
              jpegSize >= 0,
              "frame is splitted, remaining bytes: " + jpegSize
            );
          } else {
            self.emit("liveviewJpeg", frameNumber, imageBuffer);
            buffer = chunk.slice(jpegSize + paddingSize);
            // console.log(
            //   "frame completed",
            //   imageBuffer.length,
            //   "remaining bytes",
            //   chunk.length
            // );
            jpegSize = 0;
            bufferIndex = 0;
            // console.log(buffer.subarray(0, 100))
          }
        }
      });

      liveview.on("end", function() {
        console.log("End");
      });

      liveview.on("close", function() {
        console.log("Close");
      });
    }

    const liveviewReq = http.get(liveviewUrl, processFrame);

    liveviewReq.on("error", function(e) {
      console.error("Live view request error: ", e);
    });
    liveviewReq.end();
  });
};

SonyCamera.prototype.stopViewfinder = function(callback) {
  this.call("stopLiveview", null, callback);
};

SonyCamera.prototype.capture = function(enableDoubleCallback, callback) {
  var self = this;

  if (!callback && typeof enableDoubleCallback == "function") {
    callback = enableDoubleCallback;
    enableDoubleCallback = false;
  }

  if (this.status != "IDLE") {
    console.log(
      "SonyWifi: camera busy, capture not available.  Status:",
      this.status
    );
    return callback && callback("camera not ready");
  }

  this.ready = false;

  var processCaptureResult = function(err, output) {
    if (err) {
      if (err.length > 0 && err[0] == 40403) {
        // capture still in progress
        self.call("awaitTakePicture", null, processCaptureResult);
      } else {
        callback && callback(err);
      }
      return;
    }

    var url = output[0][0];

    var parts = url.split("?")[0].split("/");
    var photoName = parts[parts.length - 1];
    console.log("SonyWifi: Capture complete:", photoName);

    if (enableDoubleCallback) callback && callback(err, photoName);

    http
      .get(url, function(res) {
        //res.setEncoding('binary');

        var statusCode = res.statusCode;
        var contentType = res.headers["content-type"];

        var error;
        if (statusCode !== 200) {
          error = new Error("Request Failed. Status Code:", statusCode);
        }
        if (error) {
          //console.log(error.message);
          // consume response data to free up memory
          res.resume();
          callback && callback(err);
          return;
        }

        var rawData = [];
        res.on("data", function(chunk) {
          //console.log("got data", chunk.length);
          rawData.push(chunk);
        });
        res.on("end", function() {
          console.log("SonyWifi: Retrieved preview image:", photoName);
          callback && callback(null, photoName, Buffer.concat(rawData));
        });
      })
      .on("error", function(e) {
        callback && callback(e);
      });
  };

  self.call("actTakePicture", null, processCaptureResult);
};

SonyCamera.prototype.startBulbShooting = function(callback) {
  console.log("startBulbShooting");
  this.call("startBulbShooting", null, callback);
};

SonyCamera.prototype.stopBulbShooting = function(callback) {
  console.log("stopBulbShooting");
  this.call("stopBulbShooting", null, callback);
};

SonyCamera.prototype.zoomIn = function(callback) {
  this.call("actZoom", ["in", "start"], callback);
};

SonyCamera.prototype.zoomOut = function(callback) {
  this.call("actZoom", ["out", "start"], callback);
};



SonyCamera.prototype.getAppVersion = function(callback) {
  this.call("getApplicationInfo", null, function(err, res) {
    var version = null;
    if (!err && res && res.length > 1) {
      version = res[1];
    }
    callback && callback(err, version);
  });
};

SonyCamera.prototype.set = function(param, value, callback) {
  if (this.status != "IDLE") return callback && callback("camera not ready");

  var action = "set" + param.charAt(0).toUpperCase() + param.slice(1);
  if (this.availableApiList.indexOf(action) === -1 || !this.params[param]) {
    return callback && callback("param not available");
  }
  if (this.params[param].available.indexOf(value) === -1) {
    return callback && callback("value not available");
  }
  this.call(action, [value], callback);
};

// // Client-side export
// if (typeof window !== "undefined" && window.SonyCamera) {
//   window.SonyCamera = SonyCamera;
// }

SonyCamera.prototype.getServerInfo = function() {
  this.call("getAvailableApiList", [], (msg, b, c) => console.log(msg, b, c));
};

module.exports = SonyCamera;
// // Server-side export
// if (typeof module !== "undefined") {
//   module.exports = SonyCamera;
// }

// }());
