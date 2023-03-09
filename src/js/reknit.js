/* eslint-env node */

"use strict";

const {resolvePath, asyncForEach, loadJSON5File} = require("./utils.js");

const fs = require("fs-extra"),
    linkedom = require("linkedom");

const parseDocument = function (path) {
    const text = fs.readFileSync(path, "utf8");
    return linkedom.parseHTML(text).document;
};

const writeFile = function (filename, data) {
    fs.writeFileSync(filename, data, "utf8");
    const stats = fs.statSync(filename);
    console.log("Written " + stats.size + " bytes to " + filename);
};

// Hide the divs which host the original leaflet maps and return their respective section headers
const hideLeafletWidgets = function (container) {
    const widgets = [...container.querySelectorAll(".html-widget.leaflet")];
    widgets.forEach(function (widget) {
        widget.removeAttribute("style");
    });
    const sections = widgets.map(widget => widget.closest(".section.level2"));
    console.log("Found " + sections.length + " sections holding Leaflet widgets");
    return sections;
};

/** Compute figures to move to data pane, by searching for selector `.data-pane`, and if any parent is found
 * with class `figure`, widening the scope to that
 * @param {Element} container - The DOM container to be searched for elements to move
 * @return {Element[]} - An array of DOM elements to be moved to the data pane
 */
const figuresToMove = function (container) {
    const toMoves = [...container.querySelectorAll(".data-pane")];
    const widened = toMoves.map(function (toMove) {
        const figure = toMove.closest(".figure");
        return figure || toMove;
    });
    return widened;
};

/** Move plotly widgets which have siblings which are maps into children of the .mxcw-data pane
 * @param {Document} template - The document for the template structure into which markup is being integrated
 * @param {Element[]} sections - The array of section elements found holding leaflet maps
 * @param {Element} container - The container node with class `.main-container` found in the original knitted markup
 * @return {Element[]} An array of data panes corresponding to the input section nodes
 */
const movePlotlyWidgets = function (template, sections, container) {
    const data = template.querySelector(".mxcw-data");
    if (!data) {
        throw "Error in template structure - data pane not found with class mxcw-data";
    }
    const dataDivs = sections.map(() => {
        const div = template.createElement("div");
        div.setAttribute("class", "mxcw-widgetPane");
        data.appendChild(div);
        return div;
    });

    const plotlys = [...container.querySelectorAll(".html-widget.plotly")];
    console.log("Found " + plotlys.length + " Plotly widgets in " + sections.length + " heading sections");
    const toDatas = figuresToMove(container);
    console.log("Found " + toDatas.length + " elements to move to data pane");
    const toMoves = [...plotlys, ...toDatas];
    toMoves.forEach(function (toMove, i) {
        const closest = toMove.closest(".section.level2");
        const index = sections.indexOf(closest);
        console.log("Found section for plotly widget at index " + index);
        if (index !== -1) {
            toMove.setAttribute("data-section-index", "" + index);
            dataDivs[index].appendChild(toMove);
        } else {
            console.log("Ignoring widget at index " + i + " since it has no sibling map");
        }
    });
    return dataDivs;
};

const reknitFile = async function (infile, outfile, options) {
    const document = parseDocument(resolvePath(infile));
    const container = document.querySelector(".main-container");
    const sections = hideLeafletWidgets(container);
    const template = parseDocument(resolvePath(options.template));
    movePlotlyWidgets(template, sections, container);
    container.querySelector("h1").remove();
    await asyncForEach(options.transforms || [], async (rec) => {
        const file = require(resolvePath(rec.file));
        const transform = file[rec.func];
        await transform(document, container);
    });
    const target = template.querySelector(".mxcw-content");
    target.appendChild(container);
    const outMarkup = "<!DOCTYPE html>" + template.documentElement.outerHTML;
    writeFile(resolvePath(outfile), outMarkup);
};

/** Copy dependencies into docs directory for GitHub pages **/

const copyDep = function (source, target) {
    const targetPath = resolvePath(target);
    fs.copySync(resolvePath(source), resolvePath(target));
    fs.chmodSync(targetPath, "644");
};

const reknit = async function () {
    const config = loadJSON5File("%maxwell/config.json5");
    await asyncForEach(config.reknitJobs, async (rec) => reknitFile(rec.infile, rec.outfile, rec.options));

    config.copyJobs.forEach(function (dep) {
        copyDep(dep.source, dep.target);
    });
};

reknit().then();


