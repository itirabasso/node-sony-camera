import React, { useMemo, useState, useEffect } from "react";
import "./App.css";
// import useEventListener from "@use-it/event-listener";
import io from "socket.io-client";
import { Z_NO_COMPRESSION } from "zlib";

// import SonyCamera from "sony-camera";

function App() {
  const [socket, setSocket] = useState();
  const [image, setImage] = useState("");
  const [updates, setUpdates] = useState([]);
  const [settings, setSettings] = useState({});

  let ps = {};
  // const cam = useMemo(() => startCamera(), []);
  // const cam = useCallback(() => useCamera(), []);

  useEffect(() => {
    const s = io.connect("http://localhost:3001");

    s.on("image", img => {
      console.log("live view jpge", img.length);
      if (img) {
        setImage(img.toString("base64"));
      }
    });

    s.on("update", (param, value) => {
      // console.log("update x", param, value);
      updateSetting(param, value);
    });

    s.on("params", params => {
      console.log("params", params);
      ps = params;
      setSettings(params);
    });

    s.on("status", message => {
      console.log("status update", message);
      updates.push(message);
      setUpdates(updates);
      // $('#updates').append($('<li>').text(message));
    });

    setSocket(s);
  }, []);

  const buildSettings = () => {
    // console.log('settings length', Object.keys(settings).length)
    return Object.entries(settings).map(([name, setting]) => {
      // console.log("building setting", name, setting);
      const { available, current } = setting;
      let options;
      if (available === undefined || available.length === 0) {
        options = (
          <option key={name} selected="true">
            {current}
          </option>
        );
      } else {
        options = (available || []).map((value, i) => (
          <option key={i} selected={current === value}>
            {value}
          </option>
        ));
      }

      return (
        <li>
          {name}
          <select
            id={"param-" + name}
            onChange={e => {
              console.log("setting", name, e.target.value);
              socket.emit("set", name, e.target.value);
            }}
          >
            {options}>
          </select>
        </li>
      );
    });
  };

  const updateSetting = (name, data) => {
    // console.log("Update setting", name, data, data.current);
    // cam.set(name, data.current);
    // console.log("settings", settings);
    // const setting = settings[name] || {};
    console.log("updating", name, data);
    console.log(settings, ps);
    setSettings({
      ...ps,
      [name]: data
    });
  };

  const capture = doubleCallback => {
    socket.emit("capture");
  };

  const startViewer = () => {
    socket.emit("startViewfinder");
  };

  const stopViewer = () => {
    socket.emit("stopViewfinder");
  };

  const zoomIn = () => {
    socket.emit('zoomIn')
  }

  const settingElements = useMemo(() => buildSettings(), [settings]);
  const updateMessages = useMemo(() => updates.map(m => <li>{m}</li>));

  return (
    <div>
      <div id="panel1">
        <ul id="params">{settingElements}</ul>
        <button id="capture" onClick={() => capture(true)}>
          Capture
        </button>
        <button id="startViewfinder" onClick={() => startViewer()}>
          Liveview On
        </button>
        <button id="stopViewfinder" onClick={() => stopViewer()}>
          Liveview Off
        </button>
        <button onClick={() => zoomIn()}>zoom in</button>
      </div>
      <div id="panel2">
        <img
          id="view-finder"
          src={"data:image/png;base64," + image}
          width="100%"
        ></img>
      </div>
      <div id="panel3">
        <ul id="updates">{updateMessages}</ul>
      </div>
    </div>
  );
}

export default App;
