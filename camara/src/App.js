import React, { useMemo, useState, useEffect } from "react";
import "./App.css";
// import useEventListener from "@use-it/event-listener";

import SonyCamera from "sony-camera";

function App() {
  const [image, setImage] = useState("");
  const [settings, setSettings] = useState({});
  const [cam, setCam] = useState();
  // const cam = useMemo(() => startCamera(), []);
  // const cam = useCallback(() => useCamera(), []);
  const settingElements = useMemo(() => buildSettings(), [settings]);

  function buildSettings() {
    return Object.entries(settings).map(([name, settings]) => {
      // console.log("building setting", name, settings);
      const options = (settings.available || []).map((value, index) => {
        const selected = settings.current === value;
        return <option selected={selected}>{value}</option>;
      });

      return (
        <li>
          {name}
          <select
            id={"param-" + name}
            onChange={e => {
              console.log("event", e);
              // updateSetting(name, e.target.value);
              cam.set(name, e.target.value, () => {});
            }}
          >
            {options}>
          </select>
        </li>
      );
    });
  }

  function updateSetting(name, data) {
    console.log("Update setting", name, data, data.current);
    // cam.set(name, data.current);
    console.log("settings", settings);
    const setting = settings[name] || {};
    console.log(setting)
    setSettings({
      ...settings,
      [name]: {
        ...setting,
        current: data
      }
    });
  }

  useEffect(() => {
    const cam = new SonyCamera();

    // console.log("cam", cam);
    cam.on("update", (param, value) => {
      console.log("update", param, value);
      updateSetting(param, value);
    });
    // useEventListener(
    //   "liveviewJpeg",
    //   img => {
    //     console.log("live view jpge", img.length);
    //     if (img) {
    //       setImage(img.toString("base64"));
    //     }
    //   },
    //   cam
    // );
    cam.on("liveviewJpeg", img => {
      console.log("live view jpge", img.length);
      if (img) {
        setImage(img.toString("base64"));
      }
    });

    cam.connect(() => {
      console.log("connected", cam, cam.params);
      console.log("a", settings);
      setSettings(cam.params);
      console.log("b", settings);
    });

    setCam(cam);
  }, []);

  const capture = doubleCallback => {
    cam.capture(doubleCallback, (err, name, image) => {
      if (err) {
        console.log("status", "Error", err);
      }
      if (image) {
        setImage(image.toString("base64"));
      }
      if (name && !image) {
        console.log("status", "new photo", name);
      }
    });
  };

  const startViewer = () => {
    cam.startViewfinder();
  };

  const stopViewer = () => {
    cam.stopViewfinder();
  };

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
      </div>
      <div id="panel2">
        <img
          id="view-finder"
          src={"data:image/png;base64," + image}
          width="100%"
        ></img>
      </div>
      <div id="panel3">
        <ul id="updates"></ul>
      </div>
    </div>
  );
}

export default App;
