"use strict";

/* global L, HTMLWidgets */

window.HTMLWidgets = window.HTMLWidgets || {};

// Taken from https://github.com/ramnathv/htmlwidgets/blob/master/inst/www/htmlwidgets.js
window.HTMLWidgets.dataframeToD3 = function (df) {
    const names = [];
    let length;
    for (const name in df) {
        if (df.hasOwnProperty(name)) {
            names.push(name);
        }
        if (typeof(df[name]) !== "object" || typeof(df[name].length) === "undefined") {
            throw new Error("All fields must be arrays");
        } else if (typeof(length) !== "undefined" && length !== df[name].length) {
            throw new Error("All fields must be arrays of the same length");
        }
        length = df[name].length;
    }
    const results = [];
    let item;
    for (let row = 0; row < length; row++) {
        item = {};
        for (let col = 0; col < names.length; col++) {
            item[names[col]] = df[names[col]][row];
        }
        results.push(item);
    }
    return results;
};

const maxwell = {};

maxwell.findLeafletWidgets = function () {
    const widgets = [...document.querySelectorAll(".html-widget.leaflet")];
    console.log("Found " + widgets.length + " widgets");
    return widgets.map(function (widget) {
        const id = widget.id;
        const dataNode = document.querySelector("[data-for=\"" + id + "\"");
        console.log("Got data node ", dataNode);
        const data = JSON.parse(dataNode.innerHTML);
        console.log("Got data ", data);
        const section = widget.closest(".section.level2");
        const heading = section.querySelector("h2");
        return {
            node: widget,
            data: data,
            section: section,
            heading: heading
        };
    });
};

maxwell.leafletiseCoords = function (coords) {
    return coords.map(poly => poly.map(HTMLWidgets.dataframeToD3));
};

// Undo bizarre "multiplexing" which is achieved by the HTMLWidgets "dataFrame" system
maxwell.resolveVectorOptions = function (options, index) {
    const entries = Object.entries(options).map(([key, val]) =>
        [key, Array.isArray(val) ? val[index] : val]
    );
    return Object.fromEntries(entries);
};

// Another demultiplexing for dataframe args
maxwell.projectArgs = function (args, index) {
    return args.map(arg => Array.isArray(arg) ? arg[index] : arg);
};

maxwell.leafletPolyMethods = {
    addPolygons: "polygon",
    addPolylines: "polyline"
};

maxwell.divIcon = function (label, className) {
    return L.divIcon({
        html: "<div>" + label + "</div>",
        iconSize: null,
        className: className
    });
};

maxwell.addMarkers = function (lat, lon, icon, label, labelOptions, paneOptions, group) {
    // Note that labelOnlyMarkers are spat out in https://github.com/rstudio/leaflet/blob/main/R/layers.R#L826
    // We detect this through the special case of a width set to 1 and use a div icon which is much
    // easier to configure than the HTMLwidgets strategy of a permanently open tooltip attached to the marker
    if (!icon) {
        const markerIcon = new L.Icon.Default();
        markerIcon.options.shadowSize = [0, 0];
        L.marker([lat, lon], Object.assign({}, {icon: markerIcon}, paneOptions)).addTo(group);
        const divIcon = maxwell.divIcon(label, labelOptions.className);
        L.marker([lat, lon], Object.assign({}, {icon: divIcon}, paneOptions)).addTo(group);
    } else {
        const Licon = icon.iconWidth === 1 ?
            maxwell.divIcon(label) :
            L.icon({
                iconUrl: icon.iconUrl,
                iconSize: [icon.iconWidth, icon.iconHeight]
            });
        L.marker([lat, lon], Object.assign({}, {icon: Licon}, paneOptions)).addTo(group);
    }
    // from https://github.com/rstudio/leaflet/blob/main/javascript/src/methods.js#L189
};

maxwell.widgetToPane = function (map, calls, index) {
    const paneName = "maxwell-pane-" + index;
    const pane = map.createPane(paneName);
    pane.classList.add("mxcw-mapPane");
    const paneOptions = {
        pane: paneName
    };
    const group = L.layerGroup(paneOptions).addTo(map);
    calls.forEach(function (call) {
        // See https://github.com/rstudio/leaflet/blob/main/javascript/src/methods.js#L550
        const polyMethod = maxwell.leafletPolyMethods[call.method];
        if (polyMethod) {
            const shapes = call.args[0],
                options = Object.assign({}, call.args[3], paneOptions);
            shapes.forEach((shape, index) =>
                L[polyMethod](maxwell.leafletiseCoords(shape),
                    maxwell.resolveVectorOptions(options, index)).addTo(group));
        } else if (call.method === "addRasterImage") {
        // args: url, bounds, opacity
            const opacity = call.args[2] ?? 1.0;
            L.imageOverlay(call.args[0], call.args[1], Object.assign({}, {
                opacity: opacity
            }, paneOptions)).addTo(group);
        } else if (call.method === "addMarkers") {
            // Very limited support currently - just for labelOnlyMarkers used in fire history
            // args: lat, lng, icon, layerId, group, options, popup, popupOptions,
            // clusterOptions, clusterId, label, labelOptions, crosstalkOptions
            const markerArgs = [call.args[0], call.args[1], call.args[2], call.args[10], call.args[11], paneOptions, group];
            if (Array.isArray(call.args[0])) {
                for (let i = 0; i < call.args[0].length; ++i) {
                    maxwell.addMarkers.apply(null, maxwell.projectArgs(markerArgs, i));
                }
            } else {
                maxwell.addMarkers.apply(null, markerArgs);
            }
        } else {
            console.log("Unknown R leaflet method " + call.method + " discarded");
        }
    });
    return pane;
};

// Search through an HTMLWidgets "calls" structure for a method with particular name
maxwell.findCall = function (calls, method) {
    return calls.find(call => call.method === method);
};

maxwell.addDocumentListeners = function (instance) {
    const widgets = instance.widgets;
    widgets.forEach(function (widget, i) {
        widget.heading.addEventListener("click", () => instance.updateActiveGroup(i));
    });
    const content = document.querySelector(".mxcw-content");
    content.addEventListener("scroll", function () {
        const scrollTop = content.scrollTop;
        const offsets = widgets.map(widget => widget.section.offsetTop);
        let index = offsets.findIndex(offset => offset > (scrollTop - 100));
        if (index === -1) {
            index = widgets.length - 1;
        }
        instance.updateActiveGroup(index);
    });
};

maxwell.registerListeners = function (instance) {
    instance.addEventListener("updateActiveGroup", function (event) {
        instance.activeGroup = event.detail.activeGroup;
    });
    instance.addEventListener("updateActiveGroup", function (event) {
        instance.panes.forEach(function (pane, i) {
            if (i === event.detail.activeGroup) {
                pane.classList.add("mxcw-activeMapPane");
            } else {
                pane.classList.remove("mxcw-activeMapPane");
            }
        });
        instance.widgets.forEach(function (widget, i) {
            if (i === event.detail.activeGroup) {
                widget.section.classList.add("mxcw-activeSection");
            } else {
                widget.section.classList.remove("mxcw-activeSection");
            }
        });
    });
};

// Pattern explained at https://medium.com/@zandaqo/eventtarget-the-future-of-javascript-event-systems-205ae32f5e6b
class maxwell_Leaflet extends EventTarget {
    constructor(options) {
        super();
        Object.assign(this, options);
        maxwell.registerListeners(this);
    }
    updateActiveGroup(activeGroup) {
        if (activeGroup !== this.activeGroup) {
            this.dispatchEvent(new CustomEvent("updateActiveGroup", {
                detail: { activeGroup: activeGroup }
            }));
        }
    }
}

maxwell.instantiateLeaflet = function (selector) {
    const widgets = maxwell.findLeafletWidgets();
    const node = document.querySelector(selector);
    const map = L.map(node);

    const data0 = widgets[0].data.x;
    const bounds = data0.fitBounds;
    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]]);

    const tiles = maxwell.findCall(data0.calls, "addTiles");
    L.tileLayer(tiles.args[0], tiles.args[3]).addTo(map);

    const panes = widgets.map((widget, i) => maxwell.widgetToPane(map, widget.data.x.calls, i));
    const instance = new maxwell_Leaflet({
        container: node,
        map: map,
        widgets: widgets,
        panes: panes,
        activeGroup: null
    });
    maxwell.leafletInstance = instance;
    instance.updateActiveGroup(0);

    maxwell.addDocumentListeners(instance);

    return instance;
};
