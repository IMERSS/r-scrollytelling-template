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

maxwell.instances = {};

maxwell.set = function (root, segs, newValue) {
    for (let i = 0; i < segs.length - 1; ++i) {
        if (!root[segs[i]]) {
            root[segs[i]] = {};
        }
        root = root[segs[i]];
    }
    root[segs[segs.length - 1]] = newValue;
};

// Lightly adapted from https://stackoverflow.com/a/59563339
maxwell.EventEmitter = class {
    constructor() {
        this.callbacks = {};
    }

    on(event, cb) {
        if (!this.callbacks[event]) {
            this.callbacks[event] = [];
        }
        this.callbacks[event].push(cb);
    }

    emit(event, data) {
        let cbs = this.callbacks[event];
        if (cbs) {
            cbs.forEach(cb => cb(data));
        }
    }
};

maxwell.findLeafletWidgets = function () {
    const widgets = [...document.querySelectorAll(".html-widget.leaflet")];
    console.log("Found " + widgets.length + " leaflet widgets");
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
            subPanes: [],
            section: section,
            heading: heading
        };
    });
};

maxwell.findPlotlyWidgets = function (instance) {
    const widgets = [...document.querySelectorAll(".html-widget.plotly")];
    const panes = [...document.querySelectorAll(".mxcw-widgetPane")];
    console.log("Found " + widgets.length + " plotly widgets");
    // TODO: Assume just one widget for now, the slider
    if (widgets.length > 0) {
        const slider = widgets[0];
        const pane = slider.closest(".mxcw-widgetPane");
        const index = panes.indexOf(pane);
        console.log("Plotly widget's pane index is " + index);

        slider.on("plotly_sliderchange", function (e) {
            console.log("Slider change ", e);
            instance.emitter.emit("updateSubPaneIndex", {paneIndex: index, subPaneIndex: e.slider.active});
        });
        instance.emitter.emit("updateSubPaneIndex", {paneIndex: index, subPaneIndex: 0});
    }
};

maxwell.findDataPanes = function (widgets) {
    const dataPanes = document.querySelectorAll(".mxcw-widgetPane");
    if (dataPanes.length > 0) {
        if (dataPanes.length !== widgets.length) {
            throw "Error during reweaving - emitted " + dataPanes.length + " data panes for " + widgets.length + " widgets";
        } else {
            return dataPanes;
        }
    } else {
        return null;
    }
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

maxwell.divIcon = function (label, className) {
    return L.divIcon({
        html: "<div>" + label + "</div>",
        iconSize: null,
        className: className
    });
};

maxwell.addMarkers = function (lat, lon, icon, label, labelOptions, paneOptions, group) {
    const pane = paneOptions.pane;
    // Note that labelOnlyMarkers are spat out in https://github.com/rstudio/leaflet/blob/main/R/layers.R#L826
    // We detect this through the special case of a width set to 1 and use a div icon which is much
    // easier to configure than the HTMLwidgets strategy of a permanently open tooltip attached to the marker
    if (!icon) {
        const markerIcon = new L.Icon.Default();
        markerIcon.options.shadowSize = [0, 0];
        const marker = L.marker([lat, lon], Object.assign({}, {icon: markerIcon}, paneOptions)).addTo(group);
        const divIcon = maxwell.divIcon(label, labelOptions.className);
        const labelMarker = L.marker([lat, lon], Object.assign({}, {icon: divIcon}, paneOptions)).addTo(group);
        maxwell.set(maxwell.instances, [pane, label], {marker, labelMarker});
        const paneInstance = maxwell.globalOptions.paneMap[pane];
        const clickHandler = function () {
            paneInstance.emitter.emit("click", label);
        };
        if (paneInstance) {
            marker.on("click", clickHandler);
            labelMarker.on("click", clickHandler);
        }
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

maxwell.allocatePane = function (map, index, subLayerIndex) {
    let paneName = "maxwell-pane-" + index;
    if (subLayerIndex !== undefined) {
        paneName += "-subpane-" + subLayerIndex;
    }
    const pane = map.createPane(paneName);
    pane.classList.add("mxcw-mapPane");
    if (subLayerIndex !== undefined) {
        pane.classList.add("mxcw-mapSubPane");
    }
    const paneOptions = {
        pane: paneName
    };
    const group = L.layerGroup(paneOptions).addTo(map);
    return {paneName, pane, paneOptions, group};
};

// Allocate a polygonal leaflet call into a pane or subpane
maxwell.assignToPane = function (callArgs, polyMethod, paneInfo) {
    const shapes = callArgs[0],
        options = Object.assign({}, callArgs[3], paneInfo.paneOptions);
    shapes.forEach((shape, index) =>
        L[polyMethod](maxwell.leafletiseCoords(shape),
            maxwell.resolveVectorOptions(options, index)).addTo(paneInfo.group));
};

maxwell.leafletPolyMethods = {
    addPolygons: "polygon",
    addPolylines: "polyline"
};

maxwell.leafletWidgetToPane = function (map, widget, index) {
    const calls = widget.data.x.calls;
    const paneInfo = maxwell.allocatePane(map, index);
    const {paneOptions, group} = paneInfo;
    calls.forEach(function (call) {
        // See https://github.com/rstudio/leaflet/blob/main/javascript/src/methods.js#L550
        const polyMethod = maxwell.leafletPolyMethods[call.method];
        if (polyMethod) {
            const subLayerIndex = call.args[3].mx_subLayerIndex;
            if (subLayerIndex !== undefined) {
                const subPaneInfo = maxwell.allocatePane(map, index, subLayerIndex);
                maxwell.assignToPane(call.args, polyMethod, subPaneInfo);
                widget.subPanes[subLayerIndex] = subPaneInfo;
            } else {
                maxwell.assignToPane(call.args, polyMethod, paneInfo);
            }
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
    widget.pane = paneInfo.pane;
};

// Search through an HTMLWidgets "calls" structure for a method with particular name
maxwell.findCall = function (calls, method) {
    return calls.find(call => call.method === method);
};

maxwell.addDocumentListeners = function (instance) {
    const widgets = instance.leafletWidgets;
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

maxwell.toggleActiveClass = function (nodes, selectedIndex, clazz) {
    nodes.forEach(function (node, i) {
        if (i === selectedIndex) {
            node.classList.add(clazz);
        } else {
            node.classList.remove(clazz);
        }
    });
};

maxwell.setSubPaneVisibility = function (instance, event) {
    const subPanes = instance.leafletWidgets[event.paneIndex].subPanes.map(paneInfo => paneInfo.pane);
    console.log("updateSlider subPanes ", subPanes);
    maxwell.toggleActiveClass(subPanes, event.subPaneIndex, "mxcw-activeMapPane");
};

maxwell.registerListeners = function (instance) {
    const widgets = instance.leafletWidgets;
    instance.emitter.on("updateActiveGroup", function (event) {
        instance.activeGroup = event.activeGroup;
    });
    instance.emitter.on("updateSubPaneIndex", function (event) {
        instance.subPaneIndices[event.paneIndex] = event.subPaneIndex;
    });
    instance.emitter.on("updateActiveGroup", function (event) {
        maxwell.toggleActiveClass(widgets.map(widget => widget.pane), event.activeGroup, "mxcw-activeMapPane");
        maxwell.toggleActiveClass(widgets.map(widget => widget.section), event.activeGroup, "mxcw-activeSection");
    });
    if (instance.dataPanes) {
        instance.emitter.on("updateActiveGroup", function (event) {
            const paneIndex = event.activeGroup;
            maxwell.toggleActiveClass(instance.dataPanes, paneIndex, "mxcw-activeWidgetPane");
            // Trigger update of panes which are brought into visibility - hide all others too - naturally this would all be much nicer with a functional pattern
            const allPanes = Object.keys(instance.subPaneIndices);
            allPanes.forEach(paneIndex => maxwell.setSubPaneVisibility(instance, {paneIndex: paneIndex, subPaneIndex: -1}));
            // Re-expose what was previously visible
            instance.emitter.emit("updateSubPaneIndex", {paneIndex: paneIndex, subPaneIndex: instance.subPaneIndices[paneIndex]});
        });
        instance.emitter.on("updateSubPaneIndex", function (event) {
            if (event.paneIndex === instance.activeGroup) {
                maxwell.setSubPaneVisibility(instance, event);
            }
        });
    }
};

class maxwell_Leaflet {
    constructor(options) {
        this.emitter = new maxwell.EventEmitter();
        Object.assign(this, options);
        maxwell.registerListeners(this);
    }
    updateActiveGroup(activeGroup) {
        if (activeGroup !== this.activeGroup) {
            this.emitter.emit("updateActiveGroup", { activeGroup } );
        }
    }
}

maxwell.applyView = function (map, xData) {
    const bounds = xData.fitBounds;
    const setView = xData.setView;
    if (bounds) {
        map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]]);
    } else if (setView) {
        map.setView(setView[0], setView[1]);
    } else {
        console.error("Unable to find map view information in widget data ", xData);
    }
};

maxwell.instantiateLeaflet = function (selector, options) {
    options = options || {};
    options.paneMap = options.paneMap || {};
    maxwell.globalOptions = options;
    const leafletWidgets = maxwell.findLeafletWidgets();
    const node = document.querySelector(selector);
    const map = L.map(node);

    const data0 = leafletWidgets[0].data.x;
    maxwell.applyView(map, data0);

    const tiles = maxwell.findCall(data0.calls, "addTiles");
    L.tileLayer(tiles.args[0], tiles.args[3]).addTo(map);

    leafletWidgets.forEach((widget, i) => maxwell.leafletWidgetToPane(map, widget, i));

    const instance = new maxwell_Leaflet({
        container: node,
        map: map,
        leafletWidgets: leafletWidgets, // Array of {node, data, section, heading} for each section holding a Leaflet widget
        dataPanes: maxwell.findDataPanes(leafletWidgets),
        activeGroup: null,
        subPaneIndices: {}
    });
    maxwell.leafletInstance = instance;
    instance.updateActiveGroup(0);

    maxwell.addDocumentListeners(instance);

    HTMLWidgets.addPostRenderHandler(function () {
        maxwell.findPlotlyWidgets(instance);
    });

    return instance;
};
