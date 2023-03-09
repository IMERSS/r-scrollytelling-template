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

/**
 * Information about a scrollable section element of a scrollytelling interface
 *
 * @typedef {Object} SectionHolder
 * @property {HTMLElement} section - The section node housing the widget
 * @property {HTMLElement} heading - The heading (currently h2 node) housing the widget
 */

/**
 * Decoded information about a Leaflet widget
 *
 * @typedef {SectionHolder} LeafletWidgetInfo
 * @property {HTMLElement} [widget] - The DOM node holding the widget
 * @property {Object} data - The `data` entry associated with the widget
 * @property {HTMLElement} [pane] - The pane to which the widget is allocated in the target map
 * @property {Array} subPanes - Any subpanes to which the widget's calls are allocated
 */

/**
 * Searches the current document for HTMLWidgets nodes representing Leaflet widgets, their surrounding
 * section and heading notes, and returns a structure respresenting them.
 *
 * @return {LeafletWidgetInfo[]} An array of structures representing the Leaflet widgets
 */
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

// From https://gis.stackexchange.com/questions/31951/showing-popup-on-mouse-over-not-on-click-using-leaflet
maxwell.hoverPopup = function (layer, paneOptions) {
    const mouseHandler = function (ev) {
        layer.openPopup(ev.latlng);
        console.log("Open popup for pane " + paneOptions.pane);
    };
    layer.on("mouseover", mouseHandler);
    layer.on("mousemove", mouseHandler);
    layer.on("mouseout", function () {
        this.closePopup();
    });
};

maxwell.addMarkers = function (lat, lon, iconOrRadius, options, label, labelOptions, paneOptions, group) {
    const pane = paneOptions.pane;
    // Note that labelOnlyMarkers are spat out in https://github.com/rstudio/leaflet/blob/main/R/layers.R#L826
    // We detect this through the special case of a width set to 1 and use a div icon which is much
    // easier to configure than the HTMLwidgets strategy of a permanently open tooltip attached to the marker
    if (!iconOrRadius) {
        const markerIcon = new L.Icon.Default();
        markerIcon.options.shadowSize = [0, 0];
        const marker = L.marker([lat, lon], {icon: markerIcon, ...paneOptions}).addTo(group);
        const divIcon = maxwell.divIcon(label, labelOptions.className);
        const labelMarker = L.marker([lat, lon], {icon: divIcon, ...paneOptions}).addTo(group);
        const paneInstance = maxwell.globalOptions.paneMap[pane];
        const clickHandler = function () {
            paneInstance.emitter.emit("click", label);
        };
        if (paneInstance) {
            marker.on("click", clickHandler);
            labelMarker.on("click", clickHandler);
        }
    } else if (typeof(iconOrRadius) === "number") {
        const radius = iconOrRadius;
        const circleMarker = L.circleMarker([lat, lon], {radius, ...options, ...paneOptions}).addTo(group);
        if (label) {
            circleMarker.bindPopup(label, {closeButton: false, ...labelOptions});
            maxwell.hoverPopup(circleMarker, paneOptions);
        }
    } else {
        const icon = iconOrRadius;
        const Licon = icon.iconWidth === 1 ?
            maxwell.divIcon(label) :
            L.icon({
                iconUrl: icon.iconUrl,
                iconSize: [icon.iconWidth, icon.iconHeight]
            });
        L.marker([lat, lon], {icon: Licon, ...paneOptions}).addTo(group);
    }
    // from https://github.com/rstudio/leaflet/blob/main/javascript/src/methods.js#L189
};

maxwell.allocatePane = function (map, index, subLayerIndex, overridePane) {
    let paneName = "maxwell-pane-" + (index === undefined ? overridePane : index);
    if (subLayerIndex !== undefined) {
        paneName += "-subpane-" + subLayerIndex;
    }
    const paneOptions = {
        pane: paneName
    };
    let group;
    let pane = map.getPane(paneName);
    if (!pane) {
        pane = map.createPane(paneName);
        pane.classList.add("mxcw-mapPane");
        if (subLayerIndex !== undefined) {
            pane.classList.add("mxcw-mapSubPane");
        }
        group = L.layerGroup(paneOptions).addTo(map);
        map["mx-group-" + paneName] = group;
    } else {
        group = map["mx-group-" + paneName];
    }

    return {paneName, pane, paneOptions, group};
};

// Allocate a polygonal leaflet call into a pane or subpane
maxwell.assignPolyToPane = function (callArgs, polyMethod, paneInfo) {
    const shapes = callArgs[0],
        options = Object.assign({}, callArgs[3], paneInfo.paneOptions);
    shapes.forEach(function (shape, index) {
        const r = v => maxwell.resolveVectorOptions(v, index);
        const args = maxwell.projectArgs(callArgs, index);
        const polygon = L[polyMethod](maxwell.leafletiseCoords(shape), r(options)).addTo(paneInfo.group);
        const label = args[6];
        const labelOptions = args[7];
        if (label) {
            console.log("Assigned label " + label + " to polygon index " + index + " for pane " + paneInfo.paneName);
            polygon.bindPopup(label, {closeButton: false, ...labelOptions});
            maxwell.hoverPopup(polygon, paneInfo.paneOptions);
        }
    });
};

maxwell.leafletPolyMethods = {
    addPolygons: "polygon",
    addPolylines: "polyline"
};

maxwell.methodToLayoutArg = {
    addPolygons: 1,
    addRasterImage: 4
};

/**
 * Looks up any `layoutId` argument in the supplied Leaflet widget's `call` structure
 * @param {HTMLWidgetCall} call - The call to be searched
 * @return {String|undefined} - The `layoutId` argument, if any
 */
maxwell.decodeLayoutId = function (call) {
    const argPos = maxwell.methodToLayoutArg[call.method];
    return argPos && call.args[argPos];
};

/** Decodes all the calls in a leaflet widget and allocates them to an appropriate pane or subpane of the overall
 * @param {Leaflet.Map }map - The map holding the pane to which the widget's calls should be assigned
 * @param {LeafletWidgetInfo} widget - The information structure for the widget as returned from findLeafletWidgets. This will
 * be modified by the call to add a member `pane` indicating the base pane to which the widget is allocated (this may
 * be overriden by a `layerId` entry in a particular `call` entry for the widget)
 * @param {Integer} index - The index of the widget/section heading in the document structure
 */
maxwell.leafletWidgetToPane = function (map, widget, index) {
    const calls = widget.data.x.calls;
    const paneInfo = maxwell.allocatePane(map, index);
    const {paneOptions, group} = paneInfo;
    calls.forEach(function (call) {
        const overridePane = maxwell.decodeLayoutId(call);
        let overridePaneInfo, overridePaneOptions, overrideGroup;
        if (overridePane) {
            overridePaneInfo = maxwell.allocatePane(map, undefined, undefined, overridePane);
            overridePaneOptions = overridePaneInfo.paneOptions;
            overrideGroup = overridePaneInfo.group;
        }
        // See https://github.com/rstudio/leaflet/blob/main/javascript/src/methods.js#L550
        const polyMethod = maxwell.leafletPolyMethods[call.method];
        if (polyMethod) {
            // TODO: Note that because we can't tunnel arguments other than layerId for addRasterImage, we should move
            // the subLayerIndex system (used for Howe Sound choropleth) over to layerId as well to support future
            // uses of raster images in a choropleth
            const subLayerIndex = call.args[3].mx_subLayerIndex;
            if (subLayerIndex !== undefined) {
                const subPaneInfo = maxwell.allocatePane(map, index, subLayerIndex);
                maxwell.assignPolyToPane(call.args, polyMethod, subPaneInfo);
                widget.subPanes[subLayerIndex] = subPaneInfo;
            } else {
                maxwell.assignPolyToPane(call.args, polyMethod, overridePaneInfo || paneInfo);
            }
        } else if (call.method === "addRasterImage") {
            // args: url, bounds, opacity
            const opacity = call.args[2] ?? 1.0;
            L.imageOverlay(call.args[0], call.args[1], Object.assign({}, {
                opacity: opacity
            }, overridePaneOptions || paneOptions)).addTo(overrideGroup || group);
        } else if (call.method === "addMarkers" || call.method === "addCircleMarkers") {
            // Very limited support currently - just for labelOnlyMarkers used in fire history
            // args: lat, lng, icon || radius, layerId, group, options, popup, popupOptions,
            // clusterOptions, clusterId, label, labelOptions, crosstalkOptions
            const markerArgs = [call.args[0], call.args[1], call.args[2], call.args[5], call.args[10], call.args[11], paneOptions, group];
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
    const sectionHolders = instance.sectionHolders;
    sectionHolders.forEach(function (sectionHolder, i) {
        sectionHolder.heading.addEventListener("click", () => instance.updateActiveSection(i));
    });
    const content = document.querySelector(".mxcw-content");
    content.addEventListener("scroll", function () {
        const scrollTop = content.scrollTop;
        const offsets = sectionHolders.map(widget => widget.section.offsetTop);
        let index = offsets.findIndex(offset => offset > (scrollTop - 10));
        if (index === -1) {
            index = sectionHolders.length - 1;
        }
        instance.updateActiveSection(index);
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
    const sectionHolders = instance.sectionHolders;
    const widgets = instance.leafletWidgets;
    instance.emitter.on("updateActiveSection", function (event) {
        instance.activeSection = event.activeSection;
    });
    instance.emitter.on("updateActivePane", function (event) {
        instance.activePane = event.activePane;
    });
    instance.emitter.on("updateActiveSection", function (event) {
        const activePane = instance.sectionIndexToWidgetIndex(event.activeSection);
        instance.updateActivePane(activePane);
    });


    instance.emitter.on("updateSubPaneIndex", function (event) {
        instance.subPaneIndices[event.paneIndex] = event.subPaneIndex;
    });
    instance.emitter.on("updateActiveSection", function (event) {
        maxwell.toggleActiveClass(sectionHolders.map(sectionHolder => sectionHolder.section), event.activeSection, "mxcw-activeSection");
    });
    instance.emitter.on("updateActivePane", function (event) {
        const activePane = event.activePane;
        const widgetPanes = widgets.map(widget => widget.pane);
        maxwell.toggleActiveClass(widgetPanes, -1, "mxcw-activeMapPane");
        widgetPanes[activePane].style.display = "block";
        const zoom = maxwell.flyToBounds(instance.map, widgets[activePane].data.x);
        zoom.then(function () {
            maxwell.toggleActiveClass(widgetPanes, activePane, "mxcw-activeMapPane");
            window.setTimeout(function () {
                widgetPanes.forEach(function (pane, index) {
                    const visibility = (index === activePane ? "block" : "none");
                    console.log("Set visibility of index " + index + " to " + visibility);
                    pane.style.display = visibility;
                });
            }, 1);
        });
    });
    if (instance.dataPanes) {
        instance.emitter.on("updateActivePane", function (event) {
            const paneIndex = event.activePane;
            maxwell.toggleActiveClass(instance.dataPanes, paneIndex, "mxcw-activeWidgetPane");
            // Trigger update of panes which are brought into visibility - hide all others too - naturally this would all be much nicer with a functional pattern
            const allPanes = Object.keys(instance.subPaneIndices);
            allPanes.forEach(paneIndex => maxwell.setSubPaneVisibility(instance, {paneIndex: paneIndex, subPaneIndex: -1}));
            // Re-expose what was previously visible
            instance.emitter.emit("updateSubPaneIndex", {paneIndex: paneIndex, subPaneIndex: instance.subPaneIndices[paneIndex]});
        });
        instance.emitter.on("updateSubPaneIndex", function (event) {
            if (event.paneIndex === instance.activePane) {
                maxwell.setSubPaneVisibility(instance, event);
            }
        });
    }
};

class maxwell_Leaflet {
    constructor(options) {
        this.emitter = new maxwell.EventEmitter();
        Object.assign(this, options);
    }
    updateActiveSection(activeSection) {
        if (activeSection !== this.activeSection) {
            this.emitter.emit("updateActiveSection", { activeSection } );
        }
    }
    updateActivePane(activePane) {
        if (activePane !== this.activePane) {
            this.emitter.emit("updateActivePane", { activePane } );
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

maxwell.flyToBounds = function (map, xData, delay) {
    return new Promise(function (resolve) {
        const bounds = xData.fitBounds;
        if (bounds) {
            map.flyToBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], {
                duration: delay / 1000
            });
            map.once("moveend zoomend", resolve);
        } else {
            resolve();
        }
    });
};

/** Currently used to support Salish Sea Community Directory - decode from the widget's section id whether it
 * represents a location map and assign this into the widget structure
 * @param {LeafletWidgetInfo} widget - The information structure for the widget - this will be modified to include
 * a `locationId` element.
 */
maxwell.decodeLocationId = function (widget) {
    const id = widget.section.id;
    if (id.startsWith("location-map-")) {
        widget.locationId = id.substring("location-map-".length);
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
        activeSection: null,
        activePane: null,
        subPaneIndices: {},
        sectionHolders: leafletWidgets,
        zoomDuration: 2000,
        sectionIndexToWidgetIndex: x => x
    });
    maxwell.leafletInstance = instance;

    if (maxwell.mapDirectorySections) {
        Object.assign(instance, maxwell.mapDirectorySections());
        instance.sectionHolders = instance.communitySections;
    }

    maxwell.registerListeners(instance);
    instance.updateActiveSection(0);

    maxwell.addDocumentListeners(instance);

    HTMLWidgets.addPostRenderHandler(function () {
        maxwell.findPlotlyWidgets(instance);
    });

    return instance;
};
