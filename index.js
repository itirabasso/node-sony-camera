var fs = require("fs");
var url = require("url");
var http = require("http");
var semver = require("semver");
var util = require("util");
var EventEmitter = require("events").EventEmitter;
var assert = require("assert");
const needle = require("needle");

var minVersionRequired = "2.1.4";

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

SonyCamera.prototype.call = async function(method, params = [], version) {
  this.rpcReq.method = method;
  this.rpcReq.params = params;
  this.rpcReq.version = version === undefined ? "1.0" : version;
  // if (this.version !== undefined) {
  //   // console.log("version:", this.version);
  //   this.rpcReq.version = this.version;
  // }
  var data = JSON.stringify(this.rpcReq);

  // var timeoutHandle = null;
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
            // setTimeout(function() {
            //   self.call(method, params, callback);
            // });
            return;
          }
          console.log("SonyWifi: error during request", method, error);
        }
        //console.log("completed", error, result);
        // callback && callback(error, result);
      } catch (e) {
        console.log(e.message);
        // callback && callback(e);
      }
    });
  }

  const url = this.url + ":" + this.port + this.path;
  const options = {
    timeout: 2000,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(data)
    }
  };
  // console.log(url, data);
  try {
    const resp = await needle("post", url, data, options);
    resp.setEncoding("utf8");
    try {
      // console.log(resp.body)
      const parsedData = resp.body; // JSON.parse(resp.body);
      var result = parsedData ? parsedData.result : null;
      var error = parsedData ? parsedData.error : null;
      // console.log(parsedData, result, error);
      if (error) {
        if (error.length > 0 && error[0] == 1 && method == "getEvent") {
          // setTimeout(function() {
          //   self.call(method, params, callback);
          // });
          return;
        }
        console.log("SonyWifi: error during request", method, error);
      }
      // console.log("completed", error, result);
      // callback && callback(error, result);
      return result;
    } catch (e) {
      console.log("error parsing response", e);
      // callback && callback(e);
    }
  } catch (error) {
    console.log("requst error", error);
    if (error && error.code) {
      console.log("SonyWifi: network appears to be disconnected");
      this.emit("disconnected");
    }
    throw new Error(error);
  }
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

SonyCamera.prototype._processEvents = async function(
  waitForChange = false,
  callback
) {
  this.eventPending = true;
  try {
    const params = [waitForChange];
    const results = await this.call("getEvent", params, "1.0");
    results.forEach((item, index) => {
      if (!item || item.length === 0) {
        return;
      }
      if (item instanceof Array && item.length > 0) {
        item = {
          type: item[0].type,
          items: item
        };
      }
      console.log("Item", index);
      console.log(item);

      const { type } = item;
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
          // console.log('storageInformationnn', item, item.items)
          this.photosRemaining = item.items
            .filter(media => media.recordTarget)
            .map(media => media.numberOfRecordableImages || 0)
            .reduce((acc, amount) => acc + amount);
          break;

        case "availableApiList":
          this.availableApiList = item.names || [];
          break;
        case "focusStatus":
          break;
        case "zoomSetting":
          break;
        case "batteryInfo":
          const { batteryInfo } = item;
          if (batteryInfo.length === 0) break;
          this.battery = {
            denominator: batteryInfo[0].levelDenom,
            level: batteryInfo[0].levelNumer
          };
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
    });
  } catch (error) {
    throw new Error(error);
  }

  this.eventPending = false;
};

SonyCamera.prototype.connect = async function(callback) {
  if (this.connecting) {
    throw new Error("Already trying to connect");
  }

  this.connecting = true;
  console.log("Connecting...");
  try {
    const version = await this.getAppVersion();
    console.log("Application version: %s", version);
    if (!semver.gte(version, minVersionRequired)) {
      throw new Error("Application version if not compatible");
    }
    const onceConnected = () => {
      this.connected = true;
      const _checkEvents = err => {
        if (!err) {
          if (this.connected) {
            this._processEvents(true, _checkEvents);
          } else {
            console.log("SonyWifi: disconnected, stopping event poll");
          }
        } else {
          setTimeout(_checkEvents, 5000);
        }
      };
      this._processEvents(false, function() {
        this.connecting = false;
        _checkEvents();
      });
    };
    // this.version = version;
    if (this.method === "old") {
      await this.call("startRecMode");
    }

    onceConnected();
  } catch (error) {
    this.connecting = false;
    throw new Error(error);
  }
};

SonyCamera.prototype.disconnect = async function() {
  try {
    await this.call("stopRecMode");
    this.connected = false;
  } catch (error) {
    throw new Error(error);
  }
};

SonyCamera.prototype.startViewfinder = async function() {
  const result = await this.call("startLiveview");
  console.log("liveviewUrl", result[0]);
  const liveviewUrl = result[0]; //url.parse(result[0]);
  //console.log(liveviewUrl);

  const COMMON_HEADER_SIZE = 8;
  const PAYLOAD_HEADER_SIZE = 128;
  const JPEG_SIZE_POSITION = 4;
  const PADDING_SIZE_POSITION = 7;
  const FRAME_NUMBER_POSITION = 2;

  var jpegSize = 0;
  var paddingSize = 0;
  var bufferIndex = 0;
  let imageBuffer;
  const self = this;
  function processFrame(chunk) {
    // console.log("chunk", chunk);
    // const { statusCode } = liveview;
    // if (statusCode !== 200) {
    //   console.log("status code:", statusCode);
    // }
    let buffer = Buffer.alloc ? Buffer.alloc(0) : new Buffer(0);
    let frameNumber = 0;
    // console.log('before imageBuffer', imageBuffer);
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
        return;
        const pos = buffer.indexOf("24356879", 0, "hex");
        console.log(pos);
        buffer = buffer.slice(pos - 8);
        console.log(buffer.subarray(0, 20));
      }
      // assert(startByte === 0xff, "invalid start byte");
      // assert(payloadType === 0x01, "invalid payload type");

      jpegSize =
        buffer.readUInt8(COMMON_HEADER_SIZE + JPEG_SIZE_POSITION) * 65536 +
        buffer.readUInt16BE(COMMON_HEADER_SIZE + JPEG_SIZE_POSITION + 1);

      frameNumber = buffer.readUInt16BE(FRAME_NUMBER_POSITION);
      paddingSize = buffer.readUInt8(
        COMMON_HEADER_SIZE + PADDING_SIZE_POSITION
      );
      // console.log(
      //   "new frame",
      //   frameNumber,
      //   jpegSize,
      //   (jpegSize / (1024 * 1024)).toString().substr(0, 4),
      //   "MB"
      // );

      imageBuffer = Buffer.alloc
        ? Buffer.alloc(jpegSize)
        : new Buffer(jpegSize);
      // console.log(imageBuffer, jpegSize);

      // skip common header and payload header
      buffer = buffer.slice(8 + 128);

      // the buffer now should contain the first part of a JPEG image
      // TODO : check jpeg header?
      if (buffer.length > 0) {
        // console.log("copying...");
        buffer.copy(imageBuffer, bufferIndex, 0, buffer.length);
        bufferIndex += buffer.length;
        // console.log("copied");
      }
      // console.log('bleep')
    } else {
      // console.log("copy 2", imageBuffer, chunk);
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
        jpegSize = 0;
        bufferIndex = 0;
        // console.log(buffer.subarray(0, 100))
      }
    }
    // });

    // liveview.on("end", function() {
    //   console.log("End");
    // });

    // liveview.on("close", function() {
    //   console.log("Close");
    // });
  }

  const liveviewReq = needle
    .get(liveviewUrl)
    .on("data", processFrame)
    .on("done", (err, resp) => {
      // console.log("done", err, resp);
    });
  // console.log('req', liveviewReq)
  // console.log("req", liveviewReq);
  // liveviewReq.on("error", function(e) {
  //   console.error("Live view request error: ", e);
  // });
  // liveviewReq.end();
};

SonyCamera.prototype.stopViewfinder = async function() {
  await this.call("stopLiveview");
};

SonyCamera.prototype.capture = async function() {

  if (this.status != "IDLE") {
    console.log(
      "SonyWifi: camera busy, capture not available.  Status:",
      this.status
    );
    throw new Error("Camera not ready");
  }

  this.ready = false;
  const result = await this.call("actTakePicture");
  const url = result[0][0];
  const parts = url.split("?")[0].split("/");
  const photoName = parts[parts.length - 1];
  console.log("SonyWifi: Capture complete:", photoName);

  try {
    const resp = await needle.get(url);
    let rawData = ""
    resp.setEncoding("binary");
    resp.on("data", chunk => {
      // console.log('chunk', chunk)
      // rawData.push(chunk)
      rawData = rawData.concat(chunk)
    })
    .on("done", (error) => {
      if (error) {
        console.log(error, newPhoto, rawData.length);
      }
      console.log('emitting newPhoto', photoName, rawData.length)
      this.emit('newPhoto', photoName, Buffer.from(rawData, 'binary'));
    });
    // console.log(resp);
  } catch (error) {
    // if (err) {
    //   if (err.length > 0 && err[0] == 40403) {
    //     // capture still in progress
    //     self.call("awaitTakePicture", null, processCaptureResult);
    //   } else {
    //     callback && callback(err);
    //   }
    //   return;
    // }
    console.log(error);
    throw new Error(error);
  }

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

SonyCamera.prototype.getAppVersion = async function(callback) {
  try {
    const resp = await this.call("getApplicationInfo");
    return resp[1];
  } catch (error) {
    throw new Error(error);
  }
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
