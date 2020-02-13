const semver = require("semver");
const util = require("util");
const EventEmitter = require("events").EventEmitter;
const needle = require("needle");

var minVersionRequired = "2.1.4";

const defaultOptions = { path: "/sony/camera", version: "1.0" };

const SonyCamera = function(url, port, path) {
  this.url = url || "192.168.122.1";
  this.port = port || 8080;
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
  this.settings = {};
};

util.inherits(SonyCamera, EventEmitter);

SonyCamera.prototype.show = function() {
  console.log(this.url + ":" + this.port + this.path);
};

SonyCamera.prototype.call = async function(method, params = [], opts) {
  opts = opts === undefined ? defaultOptions : { ...defaultOptions, ...opts };

  this.rpcReq.method = method;
  this.rpcReq.params = params;
  this.rpcReq.version = opts.version;
  var data = JSON.stringify(this.rpcReq);

  const url = this.url + ":" + this.port + opts.path;
  const options = {
    timeout: 2000,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(data)
    }
  };

  let resp;
  try {
    resp = await needle("post", url, data, options);
    resp.setEncoding("utf8");
  } catch (error) {
    console.log("requst error", error);
    if (error && error.code) {
      this.emit("disconnected");
    }
    throw new Error(error);
  }

  try {
    const parsedData = resp.body;
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

    return result;
  } catch (e) {
    console.log("error parsing response", e);
  }

  console.log("call done");
};

SonyCamera.prototype.getSetting = function(name) {
  return this.settings[name] ? this.settings[name].current : null;
};
SonyCamera.prototype.setSetting = function(name, data) {
  const { current, candidates } = data;
  if (this.settings[name] === undefined) {
    this.settings[name] = {};
  }
  if (current !== undefined) {
    this.settings[name].current = current;
  }
  if (candidates !== undefined) {
    this.settings[name].available = candidates;
  }
};

SonyCamera.prototype._emitSettingUpdate = function(name, value) {
  this.emit("update", name, value);
};

SonyCamera.prototype._processEvents = async function(waitForChange = false) {
  this.eventPending = true;
  try {
    const params = [waitForChange];
    const results = await this.call("getEvent", params, { version: "1.3" });
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
      console.log(index, item);

      const { type } = item;
      switch (type) {
        case "cameraStatus":
          this.status = item.cameraStatus;
          switch (this.status) {
            case "NotReady":
              this.connected = false;
              console.log("SonyWifi: disconnected, trying to reconnect");
              // setTimeout(() => {
              //   console.log('trying to reconnects')
              //   this.connect();
              // }, 5000);
              break;
            case "IDLE":
              this.ready = true;
              break;
            default:
              this.ready = false;
          }
          this.emit("status", item.cameraStatus);
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
          const photosRemaining = item.items
            .filter(media => media.recordTarget)
            .map(media => media.numberOfRecordableImages || 0)
            .reduce((acc, amount) => acc + amount);
          this.storage = {
            name: item.items[0].name,
            photosRemaining
          };
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
            const currentKey =
              "current" + type.charAt(0).toUpperCase() + type.slice(1);
            return {
              candidates: item[item.type + "Candidates"] || [],
              current: item[currentKey],
              type: type
            };
          };

          // const previousValue = this.getSetting(type);
          if (this.settings[type] === undefined) {
            // declare unknown setting
            const data = getEventData();
            this.setSetting(type, data);
            console.log(
              "Camera setting: %s = %s (+ %d available)",
              type,
              data.current,
              data.candidates.length
            );
          }
      }
    });
  } catch (error) {
    throw new Error(error);
  }

  this.eventPending = false;
};

SonyCamera.prototype.connect = async function() {
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

    this.connected = true;
    // const _checkEvents = err => {
    //   if (!err) {
    //     if (this.connected) {
    //       this._processEvents(true, _checkEvents);
    //     } else {
    //       console.log("SonyWifi: disconnected, stopping event poll");
    //     }
    //   } else {
    //     setTimeout(_checkEvents, 5000);
    //   }
    // };
    // await this._processEvents(false);
    
    console.log("Connected!");
    
    const apis = await this.getAvailableApiList();
    // console.log(apis);
    if (apis.includes("startRecMode")) {
      await this.call("startRecMode");
    }
    // get initial events
    await this._processEvents(false);
  
    return this;

  } catch (error) {
    this.connecting = false;
    throw new Error(error);
  }

  // if (this.method === "old") {
  // }

  onceConnected();
  const apis = await this.getAvailableApiList();
  // console.log(apis);
  if (apis.includes("startRecMode")) {
    await this.call("startRecMode");
  }
  // get initial events
  await this._processEvents(false);

  return this;
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
  console.log("got liveview url", result[0]);
  const liveviewUrl = result[0];

  const COMMON_HEADER_SIZE = 8;
  const PAYLOAD_HEADER_SIZE = 128;
  const JPEG_SIZE_POSITION = 4;
  const PADDING_SIZE_POSITION = 7;
  const FRAME_NUMBER_POSITION = 2;

  let jpegSize = 0;
  let imageBuffer;
  let frameNumber = 0;
  const self = this;
  let buffer = Buffer.alloc ? Buffer.alloc(0) : new Buffer(0);
  function processFrame(chunk) {
    // concat incoming chunk to buffer
    if (chunk !== undefined) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    if (buffer.length < COMMON_HEADER_SIZE + PAYLOAD_HEADER_SIZE) {
      return;
    }
    // let a = buffer.indexOf("24356879", 0, "hex");
    // console.log("found payload header at", a, buffer.length);
    const startByte = buffer.readUIntBE(0, 1);
    const payloadType = buffer.readUIntBE(1, 1);
    if (startByte !== 0xff) {
      return;
    }
    // assert(startByte === 0xff, "invalid start byte");
    jpegSize =
      buffer.readUInt8(COMMON_HEADER_SIZE + JPEG_SIZE_POSITION) * 65536 +
      buffer.readUInt16BE(COMMON_HEADER_SIZE + JPEG_SIZE_POSITION + 1);
    frameNumber = buffer.readUInt16BE(FRAME_NUMBER_POSITION);
    paddingSize = buffer.readUInt8(COMMON_HEADER_SIZE + PADDING_SIZE_POSITION);
    // console.log(
    //   "new frame",
    //   frameNumber,
    //   jpegSize,
    //   (jpegSize / (1024 * 1024)).toString().substr(0, 4),
    //   "MB"
    // );

    //
    if (buffer.length < jpegSize + 8 + 128) {
      // + paddingSize?
      return;
    }
    imageBuffer = Buffer.alloc ? Buffer.alloc(jpegSize) : new Buffer(jpegSize);

    // skip common header and payload header
    buffer = buffer.slice(8 + 128);

    // TODO : check jpeg header?
    buffer.copy(imageBuffer, 0, 0, jpegSize);
    self.emit("liveviewJpeg", frameNumber, imageBuffer);
    buffer = buffer.slice(jpegSize + paddingSize);

    // if there's any data left in the buffer we process it
    processFrame();
  }

  needle
    .get(liveviewUrl)
    .on("data", processFrame)
    .on("done", (err, resp) => {
      console.log("liveview streaming done", err, resp);
    });
};

SonyCamera.prototype.stopViewfinder = async function() {
  await this.call("stopLiveview");
};

SonyCamera.prototype.getPostview = async function() {
  let buffer = Buffer.alloc ? Buffer.alloc(0) : new Buffer(0);
  return new Promise((resolve, reject) => {
    try {
      needle
        .get(url)
        .on("data", chunk => {
          // console.log("data get post view");
          buffer = Buffer.concat([buffer, chunk]);
        })
        .on("done", error => {
          // console.log("done capture", error);
          if (error) {
            console.log(error, newPhoto, buffer.length);
          }
          console.log("emitting newPhoto", photoName, buffer.length);
          resolve(photoName, buffer);
          // this.emit("newPhoto", photoName, buffer);
        });
    } catch (error) {
      reject("should call await take picteure");
      // if ((error.code = 40403)) {
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
  });
  // console.log(resp);
};

SonyCamera.prototype.capture = async function() {
  if (this.status != "IDLE") {
    console.warn(
      "SonyWifi: camera busy, capture not available.  Status:",
      this.status
    );
    throw new Error("Camera is not ready");
  }

  this.ready = false;
  console.info("Taking picture");
  const result = await this.call("actTakePicture");
  console.debug(result);
  const url = result[0][0];
  const parts = url.split("?")[0].split("/");
  const photoName = parts[parts.length - 1];
  console.log("SonyWifi: Capture complete:", photoName);

  return this.getPostview();
};

SonyCamera.prototype.startBulbShooting = function(callback) {
  console.log("startBulbShooting");
  this.call("startBulbShooting", null, callback);
};

SonyCamera.prototype.stopBulbShooting = function(callback) {
  console.log("stopBulbShooting");
  this.call("stopBulbShooting", null, callback);
};

SonyCamera.prototype.zoomIn = function() {
  this.call("actZoom", ["in", "start"]);
};

SonyCamera.prototype.zoomOut = function() {
  this.call("actZoom", ["out", "start"]);
};

SonyCamera.prototype.getAppVersion = async function(callback) {
  try {
    const resp = await this.call("getApplicationInfo");
    return resp[1];
  } catch (error) {
    throw new Error(error);
  }
};

SonyCamera.prototype.set = async function(name, value) {
  if (this.status != "IDLE") throw new Error("camera not ready");

  const method = "set" + name.charAt(0).toUpperCase() + name.slice(1);

  if (this.availableApiList.indexOf(method) === -1 || !this.settings[name]) {
    throw new Error("param not available");
  }
  if (this.settings[name].available.indexOf(value) === -1) {
    throw new Error("value not available");
  }

  const result = await this.call(method, [value]);
  const successful = result[0] === 0;
  if (successful) {
    this._emitSettingUpdate(name, value);
  } else {
    console.error("cant update", setting, result);
  }
};

SonyCamera.prototype.getPhotos = async function(amount = 50) {
  const params = [
    {
      uri: "storage:" + this.storage.name,
      stIdx: 0,
      cnt: amount,
      view: "flat", // flat, date
      sort: "descending"
    }
  ];
  const results = await this.call("getContentList", params, {
    path: "/avContent",
    version: "1.3"
  });
  console.log("getPhotos", results);
  return results;
  // .map(file => ({
  //   uri: file.uri,
  //   title: file.tile
  // }));
};

SonyCamera.prototype.getServerInfo = async function() {
  const result = await this.call("getAvailableApiList");
  console.log("system info", result);
};

SonyCamera.prototype.getAvailableApiList = async function() {
  const result = await this.call("getAvailableApiList");
  console.log("system info", result);
  return result[0];
};

// Client-side export
if (typeof window !== "undefined" && window.SonyCamera) {
  window.SonyCamera = SonyCamera;
}

module.exports = SonyCamera;
// // Server-side export
// if (typeof module !== "undefined") {
//   module.exports = SonyCamera;
// }

// }());
